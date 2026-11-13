"""Build Margin: inlines dev/src/{shell.html,app.css,app.js} into ../index.html (the file GitHub Pages serves)."""
import pathlib, sys
dev = pathlib.Path(__file__).resolve().parent
root = dev.parent
shell = (dev / 'src/shell.html').read_text()
css = (dev / 'src/app.css').read_text()
js = (dev / 'src/app.js').read_text()
if '</script' in js:
    sys.exit('app.js must not contain "</script"')
out = shell.replace('/*CSS*/', css).replace('/*JS*/', js)
(root / 'index.html').write_text(out)
print(f'built index.html ({len(out):,} bytes)')
