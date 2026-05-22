.PHONY: gp

gp:
	@MSG="$(m)"; \
	if [ -z "$$MSG" ]; then \
		MSG=$$(git status --porcelain | cut -c4- | paste -sd, -); \
	fi; \
	if [ -z "$$MSG" ]; then \
		echo "No changes to commit."; \
		exit 1; \
	fi; \
	git add . && git commit -m "$$MSG" && git push
