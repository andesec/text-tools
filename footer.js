const APP_VERSION = '1.0.0';

function buildFooterLinks() {
	const embedLink = document.createElement('a');
	embedLink.href = 'embed.html';
	embedLink.textContent = 'Embed';
	embedLink.className = 'footer-link text-[var(--text-secondary)] hover:underline no-underline';

	const sep = document.createTextNode(' · ');

	const version = document.createElement('span');
	version.className = 'version';
	version.textContent = `v${APP_VERSION}`;

	const frag = document.createDocumentFragment();
	frag.appendChild(embedLink);
	frag.appendChild(sep);
	frag.appendChild(version);
	return frag;
}

(function () {
	const footers = document.querySelectorAll('footer');
	if (footers.length > 0) {
		footers.forEach((existing) => {
			const target = existing.querySelector('p') || existing;
			if (target.textContent.trim()) {
				target.appendChild(document.createTextNode(' \u00b7 '));
			}
			target.appendChild(buildFooterLinks());
		});
		return;
	}

	const f = document.createElement('footer');
	f.id = 'app-footer';
	f.appendChild(buildFooterLinks());
	document.body.appendChild(f);
})();
