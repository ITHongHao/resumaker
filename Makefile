.PHONY: setup dev test e2e backend frontend

setup:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
	cd frontend && npm install
	cd e2e && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install

backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

# Runs backend (8000) and frontend (5173, proxies /api) together; Ctrl-C stops both.
dev:
	@trap 'kill 0' INT TERM EXIT; $(MAKE) backend & $(MAKE) frontend & wait

test:
	cd backend && .venv/bin/pytest
	cd frontend && npm test

# Browser test of the whole flow against a throwaway database and the fake LLM. Needs a Chromium
# for Playwright: cd e2e && npx playwright install chromium (once).
e2e:
	cd e2e && npx playwright test
