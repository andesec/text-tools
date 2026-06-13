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

.PHONY: pr

# Create a PR from current branch to the specified branch.
# Requires GitHub CLI (gh) to be installed and authenticated.
# Usage: make pr b=main
#        make pr b=main t="My PR title"
#        make pr b=main merge=1   # auto-merge (squash) after creation
#        make pr b=main c=1       # commit + push first (runs make gp)
pr:
	@set -euo pipefail; \
	if [ "$(c)" = "1" ]; then \
		echo "Committing and pushing before creating PR..."; \
		$(MAKE) gp; \
	fi; \
	branch="$(b)"; \
	if [ -z "$$branch" ]; then \
		echo "Usage: make pr b=<branch> [t=\"PR title\"] [merge=1] [c=1]"; \
		echo "Example: make pr b=main"; \
		exit 1; \
	fi; \
	current=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$current" = "$$branch" ]; then \
		echo "Error: current branch is already '$$branch'"; \
		exit 1; \
	fi; \
	if ! command -v gh &>/dev/null; then \
		echo "Error: GitHub CLI (gh) is not installed. Install it with: brew install gh"; \
		exit 1; \
	fi; \
	echo "Creating PR from '$$current' → '$$branch'..."; \
	title="$(t)"; \
	if [ -n "$$title" ]; then \
		pr_url=$$(gh pr create --base "$$branch" --head "$$current" --title "$$title" --body ""); \
	else \
		echo "Trying --fill (requires unique commits on this branch)..."; \
		pr_url=$$(gh pr create --base "$$branch" --head "$$current" --fill 2>&1) || { \
			echo "--fill failed, using branch name as title..."; \
			fallback_title="$$(echo "$$current" | sed 's/[-_/]/ /g' | sed 's/[a-z]/\u&/')"; \
			pr_url=$$(gh pr create --base "$$branch" --head "$$current" --title "$$fallback_title" --body ""); \
		}; \
	fi; \
	echo "$$pr_url"; \
	if [ "$(merge)" = "1" ]; then \
		echo "Checking for conflicts..."; \
		mergeable=$$(gh pr view "$$pr_url" --json mergeable --jq .mergeable 2>/dev/null || echo "UNKNOWN"); \
		if [ "$$mergeable" = "UNKNOWN" ]; then \
			echo "Mergeability still being computed, waiting..."; \
			sleep 3; \
			mergeable=$$(gh pr view "$$pr_url" --json mergeable --jq .mergeable 2>/dev/null || echo "UNKNOWN"); \
		fi; \
		if [ "$$mergeable" = "CONFLICTING" ]; then \
			echo "⚠️  Conflicts detected — auto-merge skipped. Resolve conflicts manually, then run:"; \
			echo "   gh pr merge --auto --squash $$pr_url"; \
		else \
			echo "No conflicts. Enabling auto-merge (squash)..."; \
			gh pr merge --auto --squash "$$pr_url"; \
		fi; \
	fi
