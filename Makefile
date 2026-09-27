PY := .venv/bin/python
# Your machine's address on the wifi, so the phone can reach the data server.
IP := $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

.PHONY: help setup data check test app-test phone serve codegen clean \
        worker worker-check worker-deploy anywhere app-bundle expo-local ship

help:
	@echo "setup         create the venv and install the pipeline"
	@echo "data          build data/v1 from the live sources"
	@echo "check         run every test and validate the built data"
	@echo "phone         run the app on your phone against local data"
	@echo "serve         serve data/ on its own"
	@echo "codegen       regenerate the app's domain constants from Python"
	@echo "worker        run the Cloudflare worker against local data"
	@echo "worker-check  typecheck the worker and test what it serves"
	@echo "worker-deploy deploy the worker to Cloudflare"
	@echo "anywhere      run the app on your phone off-network, data from Cloudflare"
	@echo "app-bundle    export the app for Expo Go to load from the worker"
	@echo "expo-local    test that on your phone over wifi, no Metro"
	@echo "ship          app-bundle, then deploy: the app with no laptop at all"

setup:
	python3 -m venv --system-site-packages .venv
	$(PY) -m pip install -q --upgrade pip
	$(PY) -m pip install -q -e "./pipeline[dev]"
	cd app && npm install

data:
	$(PY) -m props build --out data/v1
	$(PY) -m props validate data/v1

test:
	cd pipeline && ../$(PY) -m pytest -q

app-test:
	cd app && npm run typecheck && npm test && npm run test:payloads && npm run test:detail && npm run test:format && npm run test:url

check: test app-test
	$(PY) -m props validate data/v1

codegen:
	$(PY) -m props codegen --ts app/src/domain

# Everything needed to open the app on a phone: the data server and Metro,
# with the app pointed at this machine. Scan the QR code with Expo Go.
phone:
	@test -n "$(IP)" || (echo "No wifi address found - are you on a network?" && exit 1)
	@echo "Data:  http://$(IP):8000/v1"
	@$(PY) -m http.server 8000 --directory data > /dev/null 2>&1 & echo $$! > .serve.pid
	-cd app && EXPO_PUBLIC_DATA_BASE=http://$(IP):8000/v1 npx expo start
	@kill `cat .serve.pid` 2>/dev/null || true; rm -f .serve.pid

# Point the app at this with EXPO_PUBLIC_DATA_BASE=http://<lan-ip>:8000/v1
serve:
	$(PY) -m http.server 8000 --directory data

# The worker on :8787, reading data/ as its origin instead of GitHub. Hit
# http://localhost:8787/__scheduled to force a sync, / for what it is holding.
worker:
	@$(PY) -m http.server 8111 --directory data > /dev/null 2>&1 & echo $$! > .origin.pid
	-cd worker && npx wrangler dev --port 8787 --test-scheduled \
		--var ORIGIN_BASE:http://127.0.0.1:8111/v1
	@kill `cat .origin.pid` 2>/dev/null || true; rm -f .origin.pid

# Needs `make worker` running in another terminal (and `make app-bundle` run once).
worker-check:
	cd worker && npm run typecheck
	cd app && DATA_BASE=http://localhost:8787/v1 npm run test:served
	node worker/scripts/check-update.mjs

worker-deploy:
	cd worker && npx wrangler deploy

# The app as a plain-JS expo-updates bundle, into worker/public/update/, for
# the worker to serve to Expo Go in place of Metro.
app-bundle:
	node worker/scripts/build-update.mjs

# The phone test for that, before anything is deployed: the worker on this
# machine's wifi address, serving both the app and local data. Metro is not
# running -- if Expo Go opens the app from here, it will from Cloudflare too.
expo-local: app-bundle
	@test -n "$(IP)" || (echo "No wifi address found - are you on a network?" && exit 1)
	@echo ""
	@echo "  On the phone, open in Safari:  http://$(IP):8787/open"
	@echo ""
	@$(PY) -m http.server 8111 --directory data > /dev/null 2>&1 & echo $$! > .origin.pid
	-cd worker && npx wrangler dev --ip 0.0.0.0 --port 8787 --test-scheduled \
		--var ORIGIN_BASE:http://127.0.0.1:8111/v1
	@kill `cat .origin.pid` 2>/dev/null || true; rm -f .origin.pid

# Everything the phone needs, in the cloud. Run after any app code change.
ship: app-bundle
	cd worker && npx wrangler deploy

# The app from anywhere, on cellular, with no data server on this machine:
# Metro over an ngrok tunnel, data from the deployed Worker. Expo Go still
# needs Metro, so this laptop stays awake -- but it no longer has to be on the
# same wifi, and it is no longer serving the data.
anywhere:
	cd app && npx expo start --tunnel

clean:
	rm -rf .cache pipeline/.pytest_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
