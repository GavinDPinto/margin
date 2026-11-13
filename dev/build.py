"""Build Margin into ../index.html (the single file GitHub Pages serves).

Source lives in dev/src/:
  shell.html      page skeleton (/*CSS*/ and /*JS*/ are replaced)
  css/main.css    imports the other stylesheets in order
  js/main.js      entry point; imports every other module
esbuild bundles CSS and JS; it's installed automatically into dev/node_modules on first run.
"""
import pathlib, subprocess, sys, shutil

dev = pathlib.Path(__file__).resolve().parent
root = dev.parent
esbuild = dev / 'node_modules' / '.bin' / 'esbuild'

def ensure_esbuild():
    if esbuild.exists():
        return
    print('installing esbuild (one time)…', flush=True)
    npm = shutil.which('npm') or sys.exit('npm is required to build (install Node.js)')
    subprocess.run([npm, 'install', '--no-audit', '--no-fund', '--silent'], cwd=dev, check=True)

def bundle(entry, *extra):
    r = subprocess.run([str(esbuild), str(entry), '--bundle', '--charset=utf8', '--log-level=warning', *extra],
                       cwd=dev, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'esbuild failed for {entry}:\n{r.stderr}')
    if r.stderr.strip():
        print(r.stderr, file=sys.stderr)
    return r.stdout

ensure_esbuild()
css = bundle('src/css/main.css')
js = bundle('src/js/main.js', '--format=iife', '--target=es2020,safari15')
if '</script' in js:
    sys.exit('bundled JS must not contain "</script"')
shell = (dev / 'src/shell.html').read_text()
assert '/*CSS*/' in shell and '/*JS*/' in shell
out = shell.replace('/*CSS*/', css).replace('/*JS*/', '"use strict";\n' + js)
(root / 'index.html').write_text(out)
print(f'built index.html ({len(out):,} bytes)')
