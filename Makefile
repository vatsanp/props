PY := .venv/bin/python
# Your machine's address on the wifi, so the phone can reach the data server.
IP := $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

.PHONY: help setup data check test app-test phone serve codegen clean

help:
	@echo "setup     create the venv and install the pipeline"
	@echo "data      build data/v1 from the live sources"
	@echo "check     run every test and validate the built data"
	@echo "phone     run the app on your phone against local data"
	@echo "serve     serve data/ on its own"
	@echo "codegen   regenerate the app's domain constants from Python"

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
	cd app && npm run typecheck && npm test && npm run test:payloads && npm run test:detail

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

clean:
	rm -rf .cache pipeline/.pytest_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
