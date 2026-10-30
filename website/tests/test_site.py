"""Dependency-free publication contracts. No network or application execution."""
from html.parser import HTMLParser
import hashlib
from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.links = []
        self.assets = []
        self.tags = []
        self.headings = []
        self.inputs = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append(tag)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'a':
            self.links.append(attrs.get('href', ''))
        if tag == 'link' and attrs.get('rel') in ('stylesheet', 'icon'):
            self.assets.append(attrs['href'])
        if tag == 'h1':
            self.headings.append(tag)
        if tag == 'input':
            self.inputs.append(attrs)


class SiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / 'index.html').read_text()
        cls.css = (ROOT / 'style.css').read_text()
        cls.page = Page(cls.html)

    def test_semantics_and_navigation(self):
        self.assertIn('<html lang="en">', self.html)
        self.assertIn('name="viewport"', self.html)
        self.assertEqual(len(self.page.headings), 1)
        self.assertEqual(len(self.page.ids), len(set(self.page.ids)))
        for link in self.page.links:
            if link.startswith('#'):
                self.assertIn(link[1:], self.page.ids)
        self.assertIn('Skip to content', self.html)
        self.assertIn(':focus-visible', self.css)
        self.assertIn('prefers-reduced-motion', self.css)

    def test_static_only_and_local_assets(self):
        for tag in ('script', 'iframe', 'form'):
            self.assertNotIn(tag, self.page.tags)
        # The sole input is a local CSS pause toggle; never a data-entry form.
        self.assertEqual(self.page.inputs, [{'class': 'demo-pause', 'id': 'demo-pause', 'type': 'checkbox'}])
        for asset in self.page.assets:
            self.assertTrue(asset.startswith('/'), asset)
            self.assertTrue((ROOT / urlsplit(asset).path.lstrip('/')).is_file(), asset)
        self.assertNotIn('@import', self.css)
        self.assertNotIn('url(', self.css)
        for link in self.page.links:
            self.assertTrue(link.startswith(('https://', '#', '/')), link)

    def test_content_versioned_assets_survive_cdn_and_browser_caches(self):
        for filename in ('index.html', '404.html'):
            for asset in Page((ROOT / filename).read_text()).assets:
                url = urlsplit(asset)
                digest = hashlib.sha256((ROOT / url.path.lstrip('/')).read_bytes()).hexdigest()[:12]
                self.assertEqual(parse_qs(url.query), {'v': [digest]}, filename)

    def test_downloads_name_existing_release(self):
        downloads = [a for a in self.page.links if '/releases/download/' in a]
        self.assertEqual(set(downloads), {
            'https://github.com/ffworker/Signaturee-public/releases/download/v2.0.0/signaturee-win-v2.0.0.zip',
            'https://github.com/ffworker/Signaturee-public/releases/download/v2.0.0/SHA256SUMS.txt',
        })
        self.assertNotIn('/releases/latest', self.html)
        self.assertNotIn('/actions/artifacts/', self.html)

    def test_honest_product_boundaries(self):
        for phrase in ('Classic Outlook', 'new Outlook', 'Outlook on the web',
                       'Linux, in development.', 'up to 50', 'full authenticated Linux UI',
                       'Creator', 'not a live demo or UI screenshot'):
            if phrase == 'Creator':
                self.assertIn('The creator has personally', self.html)
            else:
                self.assertIn(phrase, self.html)
        self.assertIn('https://github.com/ffworker/signaturee-linux', self.page.links)
        self.assertIn('Real LDAP acceptance', self.html)
        self.assertIn('not automatic stable releases', self.html)

    def test_editorial_specimen_and_honest_ai_disclosure(self):
        self.assertIn('Fictional signature', self.html)
        self.assertIn('Alex-Company.com', self.html)
        self.assertIn('>Alex Company<', self.html)
        self.assertNotIn('example.com', self.html)
        self.assertNotIn('Example Company', self.html)
        # Cloudflare rewrites email-shaped text and injects a decode script.
        # The static specimen must work under the no-script publication CSP.
        self.assertNotIn('@', self.html)
        self.assertIn('AI-assisted development', self.html)
        self.assertIn('details', self.page.tags)
        self.assertIn('summary', self.page.tags)
        self.assertNotIn('gradient(', self.css)

    def test_consistent_external_link_indication(self):
        self.assertIn('a[href^="https://"]:not([href^="https://signaturee.bytegeist.dev/"])::after', self.css)
        self.assertIn("content: '↗' / ' (external site)'", self.css)
        # One automatic marker, including inline/footnote/download links.
        self.assertNotIn('↗', self.html)
        self.assertNotIn('target="_blank"', self.html)

    def test_field_notes_explain_on_page_before_linking_out(self):
        notes = re.findall(r'<li class="field-note">(.*?)</li>', self.html, re.S)
        self.assertEqual(len(notes), 3)
        for note, title in zip(notes, ('Install on Windows', 'Bring your templates', 'Release with care')):
            self.assertIn('<h3>' + title + '</h3>', note)
            match = re.search(r'<p>(.*?)</p>', note)
            assert match is not None, title + ' needs an on-page summary'
            paragraph = match.group(1)
            words = re.sub('<[^>]+>', '', paragraph).split()
            self.assertGreaterEqual(len(words), 25)
            self.assertLessEqual(len(words), 80)
            self.assertIn('<a href="https://github.com/', note)
            self.assertLess(note.index('<p>'), note.index('<a '))

    def test_illustrated_generation_is_pausable_and_reduced_motion_safe(self):
        for token in ('$givenname $sn', '$department', '$website', '$mail', '$company'):
            self.assertGreaterEqual(self.html.count(token), 2, token + ' must exist in input and replacement slots')
        for field in ('name', 'department', 'website', 'mail', 'company'):
            self.assertEqual(self.html.count('data-field="' + field + '"'), 2)
        self.assertIn('class="template-document" aria-hidden="true"', self.html)
        self.assertIn('configured website/company mappings', self.html)
        self.assertIn('for="demo-pause">Pause animation', self.html)
        self.assertIn('animation-play-state: paused', self.css)
        self.assertIn('transform: translateX(-50%); animation: document-slide', self.css)
        self.assertIn('@keyframes field-out', self.css)
        self.assertIn('@keyframes field-in', self.css)
        self.assertTrue('@keyframes source-mark' in self.css,
                        'The source value should highlight with its matching signature slot')
        self.assertIn(".email-at::before { content: '@'; }", self.css)
        self.assertNotIn('@keyframes write-name', self.css)
        self.assertNotIn('@keyframes write-role', self.css)
        self.assertNotIn('@keyframes demo-token', self.css)
        self.assertNotIn('@keyframes demo-value', self.css)
        self.assertIn('.demo-pause, .demo-pause-label { display: none; }', self.css)

    def test_current_step_has_a_prominent_separate_status(self):
        self.assertIn('class="demo-status"', self.html)
        self.assertIn('CURRENT STEP', self.html)
        for label in ('01 / Template ready', '02 / Read Active Directory',
                      '03 / Signaturee replaces fields', '04 / Signature ready'):
            self.assertIn(label, self.html)
        match = re.search(r'\.demo-status \{([^}]+)\}', self.css)
        assert match is not None, 'Status needs its own high-contrast treatment'
        status = match.group(1)
        self.assertIn('background: var(--accent)', status)
        self.assertIn('color: var(--ink)', status)
        self.assertIn('14px/28px', status)
        self.assertNotIn('class="script-window"', self.html)
        self.assertNotRegex(self.css, r'(?<![\d.])12s\b')

    def test_self_service_explains_ldap_regeneration_and_setup_conditions(self):
        self.assertTrue('Fresh signatures, without an IT ticket.' in self.html,
                        'The employee benefit should be prominent')
        match = re.search(r'<dt>For employees</dt><dd>(.*?)</dd>', self.html)
        assert match is not None
        for phrase in ('LDAP', 'on demand', 'current AD data', 'group assignments',
                       'variable mappings', 'follow the import instructions'):
            self.assertIn(phrase, match.group(1))

    def test_discovery(self):
        self.assertIn('https://signaturee.bytegeist.dev/', self.html)
        sitemap = ET.parse(ROOT / 'sitemap.xml')
        locations = [e.text for e in sitemap.iter() if e.tag.endswith('}loc')]
        self.assertEqual(locations, ['https://signaturee.bytegeist.dev/'])
        self.assertIn('Sitemap: https://signaturee.bytegeist.dev/sitemap.xml',
                      (ROOT / 'robots.txt').read_text())
        ET.parse(ROOT / 'favicon.svg')

    def test_no_private_hosts_or_placeholder_links(self):
        self.assertNotRegex(self.html, r'https?://(?:localhost|127\.|10\.|192\.168\.)')
        self.assertNotIn('href="#"', self.html)
        self.assertNotRegex(self.html, r'(?i)(customer testimonial|enterprise.certified|coming soon)')


if __name__ == '__main__':
    unittest.main()
