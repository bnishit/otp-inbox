#!/usr/bin/env python3
"""Embed the README's setup prompt in the static landing page."""
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def prompt():
    section = (ROOT / 'README.md').read_text().split('## Let Codex or Claude Code set it up\n', 1)[1]
    return section.split('```text\n', 1)[1].split('\n```', 1)[0]

def rendered_page():
    page = (ROOT / 'site/index.html').read_text()
    before, rest = page.split('<!-- setup-prompt:start -->', 1)
    _, after = rest.split('<!-- setup-prompt:end -->', 1)
    return before + '<!-- setup-prompt:start --><textarea id="setup-prompt" aria-label="Full agent setup prompt" readonly spellcheck="false">' + escape(prompt()) + '</textarea><!-- setup-prompt:end -->' + after

if __name__ == '__main__':
    (ROOT / 'site/index.html').write_text(rendered_page())
    print('Landing page setup prompt synced from README.')
