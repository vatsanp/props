PY := .venv/bin/python

.PHONY: help setup data check test app-test serve codegen clean

help:
	@echo "setup     create the venv and install the pipeline"
	@echo "data      build data/v1 from the live sources"
	@echo "check     run every test and validate the built data"
	@echo "serve     serve data/ to your phone for local development"
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
	cd app && npm run typecheck && npm test && npm run test:payloads

check: test app-test
	$(PY) -m props validate data/v1

codegen:
	$(PY) -m props codegen --ts app/src/domain

# Point the app at this with EXPO_PUBLIC_DATA_BASE=http://<lan-ip>:8000/v1
serve:
	$(PY) -m http.server 8000 --directory data

clean:
	rm -rf .cache pipeline/.pytest_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
