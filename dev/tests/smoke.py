"""Margin end-to-end smoke tests.

Run from the repo root after building:   python3 dev/build.py && python3 dev/tests/smoke.py
Exits non-zero if anything fails. Screenshots go to dev/tests/shots/ (git-ignored) for a visual check.
Pointer input is simulated with real PointerEvents (pointerType pen / touch / mouse) so Pencil and finger paths are both covered.
"""
import asyncio, base64, functools, http.server, math, os, pathlib, shutil, socketserver, sys, threading

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = pathlib.Path(__file__).resolve().parent / 'fixtures'
SHOTS = pathlib.Path(__file__).resolve().parent / 'shots'
PORT = int(os.environ.get('MARGIN_TEST_PORT', '8199'))
URL = f'http://localhost:{PORT}/'

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

HELPERS = """
window.__ev = (type, id, ptype, x, y, pr) => {
  window.__tgt = window.__tgt || {};
  const t = (type !== 'pointerdown' && window.__tgt[id]) || document.elementFromPoint(x, y) || document.getElementById('scroller');
  t.dispatchEvent(new PointerEvent(type, {bubbles:true, cancelable:true, pointerId:id, pointerType:ptype, isPrimary:true, clientX:x, clientY:y,
    pressure: type==='pointerup' ? 0 : (pr ?? 0.5), buttons: type==='pointerup' ? 0 : 1, button:0}));
  if (type==='pointerdown') window.__tgt[id] = t; if (type==='pointerup') delete window.__tgt[id];
};
window.__tapEl = (sel, ptype) => { const el = document.querySelector(sel); const r = el.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2; __ev('pointerdown', 90, ptype, x, y); __ev('pointerup', 90, ptype, x, y); };
window.__file = (b64, name, type) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return new File([u], name, {type}); };
"""

async def ev(page, *a):
    await page.evaluate('([t,i,p,x,y,pr]) => __ev(t,i,p,x,y,pr)', list(a) + [None] * (6 - len(a)))
async def drag(page, ptype, pid, pts):
    await ev(page, 'pointerdown', pid, ptype, *pts[0])
    for q in pts[1:]: await ev(page, 'pointermove', pid, ptype, *q)
    await ev(page, 'pointerup', pid, ptype, *pts[-1]); await page.wait_for_timeout(60)
async def tap(page, sel, ptype):
    await page.evaluate('([s,p]) => __tapEl(s,p)', [sel, ptype]); await page.wait_for_timeout(150)
def wave(x0, y0, w, n=40): return [[x0 + w * i / n, y0 + 14 * math.sin(i / 4)] for i in range(n + 1)]
def loop(cx, cy, rx, ry): return [[cx + rx * math.cos(a), cy + ry * math.sin(a)] for a in [i / 36 * 2 * math.pi for i in range(37)]]
J = lambda page, js: page.evaluate(js)
strokes = lambda page: J(page, '__margin.E.pages[__margin.E.cur].strokes.length')

async def drop_file(page, selector, b64, name, mime):
    await page.evaluate("""([sel, b64, name, mime]) => { const dt = new DataTransfer(); dt.items.add(__file(b64, name, mime));
      const el = document.querySelector(sel); const r = el.getBoundingClientRect(); const o = {bubbles:true, cancelable:true, dataTransfer:dt, clientX:r.left+r.width/2, clientY:r.top+r.height/2};
      el.dispatchEvent(new DragEvent('dragenter', o)); el.dispatchEvent(new DragEvent('dragover', o)); el.dispatchEvent(new DragEvent('drop', o)); }""", [selector, b64, name, mime])

async def main():
    SHOTS.mkdir(exist_ok=True)
    httpd = serve()
    pdf_b64 = base64.b64encode((FIX / 'sample.pdf').read_bytes()).decode()
    errors = []
    chrome = '/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=chrome, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1180, 'height': 820}, device_scale_factor=2, has_touch=True, accept_downloads=True)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        await page.goto(URL); await page.wait_for_timeout(500); await page.add_script_tag(content=HELPERS)
        try:
            # ---------- library ----------
            await page.click('#btn-new-folder'); await page.fill('.modal .inp', 'Biology'); await page.click('.modal .btn.primary'); await page.wait_for_timeout(200)
            check('create folder', await J(page, '__margin.L.folders.length') == 1)
            await page.click('#btn-new-note'); await page.fill('.modal .inp', 'Other note'); await page.click('.modal .btn.primary'); await page.wait_for_timeout(400)
            await page.click('#ed-back'); await page.wait_for_timeout(500)
            await page.click('#btn-new-note'); await page.fill('.modal .inp', 'Smoke note')
            await page.click('.modal .tpl[data-t="grid"]'); await page.click('.modal [data-sp="36"]'); await page.click('.modal [data-ink="bold"]')
            await page.click('.modal .btn.primary'); await page.wait_for_timeout(500)
            pg0 = await J(page, '(({template,spacing,ink})=>({template,spacing,ink}))(__margin.E.pages[0])')
            check('new note with page style', pg0 == {'template': 'grid', 'spacing': 36, 'ink': 'bold'}, str(pg0))

            # ---------- ink ----------
            for i in range(3): await drag(page, 'pen', 7, wave(200, 260 + i * 50, 350))
            await drag(page, 'mouse', 1, wave(200, 430, 300))
            check('pen + mouse strokes', await strokes(page) == 4)
            await page.click('[data-tool="hl"]'); await drag(page, 'pen', 7, [[200, 262], [520, 262]])
            check('highlighter stroke', await J(page, "__margin.E.pages[0].strokes.filter(s=>s.t==='hl').length") == 1)
            await page.click('[data-tool="eraser"]'); before = await strokes(page)
            await drag(page, 'pen', 7, [[380, 230], [385, 450]])
            after = await strokes(page)
            check('precise eraser splits strokes', after > before, f'{before}->{after}')
            await page.click('#ed-undo'); check('undo', await strokes(page) == before)
            await page.click('#ed-redo'); check('redo', await strokes(page) == after)
            await page.click('#ed-undo')

            # ---------- lasso: bar buttons with pencil AND finger ----------
            await page.click('[data-tool="lasso"]')
            await drag(page, 'pen', 7, loop(380, 330, 260, 130))
            n_sel = await J(page, '__margin.E.sel ? __margin.E.sel.ids.size : 0')
            check('lasso selects', n_sel >= 4, str(n_sel))
            bar = await J(page, "[...document.querySelectorAll('.sel-bar button')].map(b=>b.dataset.sa)")
            check('selection bar has copy/cut/paste tools', all(k in bar for k in ['color', 'copy', 'cut', 'dup', 'del', 'done']), str(bar))
            total = await strokes(page)
            await tap(page, '.sel-bar [data-sa="copy"]', 'pen')
            check('copy (pencil)', await J(page, '__margin.E.clip ? __margin.E.clip.strokes.length : 0') == n_sel)
            await tap(page, '.sel-bar [data-sa="cut"]', 'touch')
            check('cut (finger)', await strokes(page) == total - n_sel)
            await drag(page, 'pen', 7, [[520, 640]])
            check('lasso tap shows paste', await J(page, "!!document.querySelector('.paste-bar')"))
            await tap(page, '.paste-bar button', 'touch')
            check('paste (finger)', await strokes(page) == total)
            await tap(page, '.sel-bar [data-sa="dup"]', 'touch')
            check('duplicate (finger)', await strokes(page) == total + n_sel)
            await tap(page, '.sel-bar [data-sa="color"]', 'pen'); await page.wait_for_timeout(150)
            await tap(page, '.pop .sw[data-c="#d1352b"]', 'pen')
            check('recolour (pencil)', await J(page, "__margin.E.pages[0].strokes.filter(s=>s.c==='#d1352b').length") == n_sel)
            bb0 = await J(page, '__margin.E.sel.bb[0]')
            c = await J(page, "(()=>{const s=__margin.E.sel,r=s.v.el.getBoundingClientRect();return [r.left+(s.bb[0]+s.bb[2])/2*__margin.E.s, r.top+(s.bb[1]+s.bb[3])/2*__margin.E.s]})()")
            await drag(page, 'touch', 33, [c, [c[0] + 40, c[1] + 20], [c[0] + 80, c[1] + 40]])
            check('move selection (finger)', await J(page, '__margin.E.sel.bb[0]') - bb0 > 20)
            w0 = await J(page, '__margin.E.sel.bb[2]-__margin.E.sel.bb[0]')
            h = await J(page, "(()=>{const r=document.querySelector('.sel-handle.h-tl').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
            await drag(page, 'touch', 34, [h, [h[0] - 30, h[1] - 10], [h[0] - 60, h[1] - 20]])
            check('resize selection (finger)', await J(page, '__margin.E.sel.bb[2]-__margin.E.sel.bb[0]') > w0 + 10)
            await tap(page, '.sel-bar [data-sa="done"]', 'pen')
            check('done clears selection', not await J(page, '!!__margin.E.sel'))

            # ---------- rectangle lasso: drag corner to corner ----------
            await page.click('#tb-opts [data-lmode="rect"]')
            check('rectangle lasso option', await J(page, "__margin.SET.lasso.mode") == 'rect' and await J(page, "!!document.querySelector('#tb-opts [data-lmode=\"rect\"].on')"))
            box = await J(page, """(()=>{const v=__margin.E.views.get(__margin.E.pages[0].id),r=v.el.getBoundingClientRect(),s=__margin.E.s;
              let b=[1e9,1e9,-1e9,-1e9];for(const st of v.page.strokes){const q=st.bb;b=[Math.min(b[0],q[0]),Math.min(b[1],q[1]),Math.max(b[2],q[2]),Math.max(b[3],q[3])];}
              const cy=(b[1]+b[3])/2;return [r.left+(b[0]-8)*s, r.top+(b[1]-8)*s, r.left+(b[2]+8)*s, r.top+cy*s];})()""")   # top half of the ink, edge to edge
            await drag(page, 'pen', 7, [[box[0], box[1]], [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], [box[2], box[3]]])   # straight diagonal: a freeform lasso would select nothing
            want = await page.evaluate("""(([X0,Y0,X1,Y1])=>{const v=__margin.E.views.get(__margin.E.pages[0].id),r=v.el.getBoundingClientRect(),s=__margin.E.s;
              const x0=(X0-r.left)/s,x1=(X1-r.left)/s,y0=(Y0-r.top)/s,y1=(Y1-r.top)/s;
              return v.page.strokes.filter(st=>{let a=0,t=0;for(let i=0;i<st.p.length;i+=3){t++;if(st.p[i]>=x0&&st.p[i]<=x1&&st.p[i+1]>=y0&&st.p[i+1]<=y1)a++;}return a/t>=0.5;}).length})""", box)
            total_now = await strokes(page)
            got = await J(page, '__margin.E.sel ? __margin.E.sel.ids.size : 0')
            check('rectangle lasso selects everything in the box', got >= 2 and got < total_now and abs(got - want) <= 1, f'{got} vs {want} of {total_now}')
            await page.screenshot(path=str(SHOTS / 'rect-lasso.png'))
            await tap(page, '.sel-bar [data-sa="done"]', 'pen')
            await page.click('#tb-opts [data-lmode="free"]')
            check('freeform lasso option restores', await J(page, "__margin.SET.lasso.mode") == 'free')

            # ---------- images: insert, resize, crop ----------
            async with page.expect_file_chooser() as fc: await page.click('#ed-image')
            await (await fc.value).set_files(str(FIX / 'photo.jpg')); await page.wait_for_timeout(900)
            im = await J(page, '__margin.E.pages[0].images[0]')
            check('insert image', bool(im) and im['cw'] == 1)
            h = await J(page, "(()=>{const r=document.querySelector('.sel-handle.h-tl').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
            await drag(page, 'pen', 7, [h, [h[0] + 40, h[1] + 20], [h[0] + 80, h[1] + 40]])
            im2 = await J(page, '__margin.E.pages[0].images[0]')
            check('resize image keeps aspect', im2['w'] < im['w'] and abs(im2['w'] / im2['h'] - im['w'] / im['h']) < 0.01)
            await tap(page, '.sel-bar [data-sa="crop"]', 'touch')
            h = await J(page, "(()=>{const r=document.querySelector('.crop-handle.h-tl').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
            await drag(page, 'touch', 35, [h, [h[0] + 60, h[1] + 40]])
            await page.screenshot(path=str(SHOTS / 'crop.png'))
            await tap(page, '.crop-bar [data-ca="done"]', 'pen')
            im3 = await J(page, '__margin.E.pages[0].images[0]')
            check('crop image', im3['cx'] > 0 and im3['cw'] < 1)
            await page.click('#ed-undo'); check('undo crop', await J(page, '__margin.E.pages[0].images[0].cw') == 1)

            # ---------- text ----------
            await page.click('[data-tool="text"]')
            await drag(page, 'mouse', 1, [[300, 720]])
            await page.keyboard.type('Smoke test text'); await page.click('[data-tool="pen"]')
            check('text box', 'Smoke test text' in await J(page, '__margin.E.pages[0].texts.map(t=>t.v)'))

            # ---------- pages ----------
            await page.click('#ed-addpage'); await page.wait_for_timeout(200)
            p2 = await J(page, '(({template,spacing})=>({template,spacing}))(__margin.E.pages[1])')
            check('add page keeps style', p2 == {'template': 'grid', 'spacing': 36}, str(p2))
            await page.click('#ed-more'); await page.click('.pop .mi:has-text("Page style")')
            await page.click('.modal .tpl[data-t="lined"]'); await page.click('.modal [data-sp="24"]'); await page.click('.modal .btn:has-text("This page")'); await page.wait_for_timeout(200)
            check('page style dialog', await J(page, '__margin.E.pages[__margin.E.cur].template') == 'lined')

            # ---------- shapes: draw, hold still, and it snaps (line / rectangle / ellipse) ----------
            async def hold_draw(ptype, pid, pts, hold=True, after=None):
                await ev(page, 'pointerdown', pid, ptype, *pts[0])
                for q in pts[1:]: await ev(page, 'pointermove', pid, ptype, *q)
                if hold: await page.wait_for_timeout(700)
                for q in after or []: await ev(page, 'pointermove', pid, ptype, *q)
                await ev(page, 'pointerup', pid, ptype, *(after or pts)[-1]); await page.wait_for_timeout(80)
            last = lambda: J(page, '(()=>{const s=__margin.E.pages[__margin.E.cur].strokes;return s[s.length-1]})()')
            def pts_of(st): P = st['p']; return [(P[i], P[i + 1]) for i in range(0, len(P), 3)]
            def line_dev(st):
                q = pts_of(st); (ax, ay), (bx, by) = q[0], q[-1]; L = math.hypot(bx - ax, by - ay) or 1
                return max(abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / L for x, y in q)
            def on_box(st):
                q = pts_of(st); xs = [x for x, _ in q]; ys = [y for _, y in q]; x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
                return max(min(abs(x - x0), abs(x - x1), abs(y - y0), abs(y - y1)) for x, y in q)
            def on_ellipse(st):
                q = pts_of(st); xs = [x for x, _ in q]; ys = [y for _, y in q]
                cx, cy, rx, ry = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2
                return max(abs(math.hypot((x - cx) / rx, (y - cy) / ry) - 1) for x, y in q)
            await J(page, "__margin.setTool('pen')")
            if not await J(page, '__margin.SET.shapes'): await page.click('#tb-opts [data-act="shapes"]')
            check('shapes toggle shown for pen', await J(page, "!!document.querySelector('#tb-opts .shp.on')"))
            r = await J(page, '(()=>{const v=__margin.E.views.get(__margin.E.pages[__margin.E.cur].id).el.getBoundingClientRect();return [v.left, Math.max(v.top, 140)]})()')
            ox, oy = r[0] + 80, r[1] + 40
            n0 = await strokes(page)
            await hold_draw('pen', 7, [[ox + 4 * i, oy + 3 * math.sin(i / 3) + i * 0.6] for i in range(60)])
            st = await last()
            check('hold snaps a wobbly line straight', await strokes(page) == n0 + 1 and line_dev(st) < 0.6, f'dev {line_dev(st):.2f}')
            await page.click('#ed-undo'); check('undo removes the snapped line in one step', await strokes(page) == n0)
            await hold_draw('pen', 7, [[ox + 4 * i, oy + 3 * math.sin(i / 3)] for i in range(40)], after=[[ox + 200, oy + 60], [ox + 260, oy + 90]])
            st = await last(); q = pts_of(st)
            check('snapped line follows the pen until lifted', line_dev(st) < 0.6 and abs(q[-1][0] - q[0][0] - (260 + 0) / await J(page, '__margin.E.s') ) < 3, f'{q[0]} -> {q[-1]}')
            box = [[ox, oy + 80], [ox + 200, oy + 83], [ox + 197, oy + 200], [ox + 2, oy + 196], [ox + 3, oy + 86]]
            boxpts = [[a[0] + (b[0] - a[0]) * t / 20 + 2 * math.sin(t), a[1] + (b[1] - a[1]) * t / 20 + 2 * math.cos(t)] for a, b in zip(box, box[1:]) for t in range(20)]
            await hold_draw('pen', 7, boxpts)
            st = await last(); check('hold snaps a rough rectangle', on_box(st) < 0.6 and len(st['p']) > 60, f'off-edge {on_box(st):.2f}')
            circ = [[ox + 340 + 70 * math.cos(a) * (1 + 0.05 * math.sin(3 * a)), oy + 140 + 55 * math.sin(a)] for a in [i / 40 * 2 * math.pi for i in range(44)]]
            await hold_draw('pen', 7, circ)
            st = await last(); check('hold snaps a rough ellipse', on_ellipse(st) < 0.02, f'err {on_ellipse(st):.3f}')
            def span(st): q = pts_of(st); xs = [x for x, _ in q]; ys = [y for _, y in q]; return max(xs) - min(xs), max(ys) - min(ys)
            w0, h0 = span(st); ex, ey = circ[-1]; dx, dy = ex - (ox + 340), ey - (oy + 140)
            await hold_draw('pen', 7, circ, after=[[ox + 340 + dx * 1.5, oy + 140 + dy * 1.5], [ox + 340 + dx * 2, oy + 140 + dy * 2]])
            st = await last(); w1, h1 = span(st)
            check('snapped ellipse grows when the held pen moves outward', on_ellipse(st) < 0.02 and 1.7 < w1 / w0 < 2.3 and abs(w1 / h1 - w0 / h0) < 0.05, f'{w0:.0f}x{h0:.0f} -> {w1:.0f}x{h1:.0f}')
            await page.click('#ed-undo')
            bw, bh = span(await (lambda: J(page, '(()=>{const s=__margin.E.pages[__margin.E.cur].strokes;return s[s.length-2]})()'))())
            ex, ey = boxpts[-1]; cx, cy = ox + 100, oy + 140
            await hold_draw('pen', 7, [[x + 260, y] for x, y in boxpts], after=[[cx + 260 + (ex - cx) * 0.75, cy + (ey - cy) * 0.75], [cx + 260 + (ex - cx) * 0.5, cy + (ey - cy) * 0.5]])
            st = await last(); w2, h2 = span(st)
            check('snapped rectangle shrinks when the held pen moves to the centre', on_box(st) < 0.6 and 0.4 < w2 / bw < 0.65, f'{bw:.0f} -> {w2:.0f}')
            await page.click('#ed-undo')
            await hold_draw('pen', 7, [[x, y + 160] for x, y in boxpts], hold=False)
            st = await last(); check('no hold keeps freehand shape', on_box(st) > 1, f'off-edge {on_box(st):.2f}')
            await page.click('[data-tool="hl"]')
            await hold_draw('pen', 7, [[ox + 4 * i, oy + 330 + 2 * math.sin(i / 2)] for i in range(50)])
            st = await last(); check('highlighter line snaps straight', st['t'] == 'hl' and line_dev(st) < 0.6)
            await page.click('#tb-opts [data-act="shapes"]'); await page.wait_for_timeout(100)
            await hold_draw('pen', 7, [[x, y + 260] for x, y in boxpts])
            st = await last(); check('shapes off: hold leaves ink as drawn', not await J(page, '__margin.SET.shapes') and on_box(st) > 1)
            await page.click('#tb-opts [data-act="shapes"]'); await J(page, "__margin.setTool('pen')")
            await page.screenshot(path=str(SHOTS / 'shapes.png'))

            # ---------- scribble to erase: zig-zag over ink with the pen erases it ----------
            def zigzag(x0, y0, w, h, passes=12):
                pts = []
                for k in range(passes):
                    ya, yb = (y0, y0 + h) if k % 2 == 0 else (y0 + h, y0)
                    xa, xb = x0 + w * k / passes, x0 + w * (k + 1) / passes
                    pts += [[xa + (xb - xa) * t / 5, ya + (yb - ya) * t / 5] for t in range(5)]
                return pts
            check('scribble toggle shown for pen', await J(page, "!!document.querySelector('#tb-opts [data-act=\"scribble\"].on')"))
            sx, sy = ox + 480, oy + 20
            n0 = await strokes(page)
            await drag(page, 'pen', 7, wave(sx, sy, 200))
            await drag(page, 'pen', 7, [[sx + 100, sy - 30], [sx + 102, sy + 10], [sx + 104, sy + 50]])   # plain line across the word stays
            check('crossing a word with a line keeps both', await strokes(page) == n0 + 2)
            await drag(page, 'pen', 7, zigzag(sx - 10, sy - 18, 220, 36))
            left = await J(page, f"__margin.E.pages[__margin.E.cur].strokes.slice({n0}).map(s=>s.p.length/3)")
            check('scribble erases the word under it, not the line mostly outside it', len(left) == 1 and left[0] <= 5, str(left))
            await page.click('#ed-undo'); check('undo brings scribbled ink back', await strokes(page) == n0 + 2)
            await drag(page, 'pen', 7, zigzag(sx, sy + 140, 200, 30))
            check('scribble on empty paper stays as ink', await strokes(page) == n0 + 3)
            await drag(page, 'pen', 7, [[sx + 100, sy + 240]])                       # a small dot
            await drag(page, 'pen', 7, zigzag(sx, sy + 225, 200, 30))                 # zig-zag letters written over it
            check('zig-zag writing over a stray dot keeps both', await strokes(page) == n0 + 5)
            await page.click('#tb-opts [data-act="scribble"]'); await page.wait_for_timeout(100)
            await drag(page, 'pen', 7, zigzag(sx - 10, sy - 18, 220, 36))
            check('scribble to erase off: scribble is just ink', not await J(page, '__margin.SET.scribble') and await strokes(page) == n0 + 6)
            await page.click('#tb-opts [data-act="scribble"]')
            await page.screenshot(path=str(SHOTS / 'scribble.png'))

            # ---------- touch gestures ----------
            await page.evaluate("document.getElementById('scroller').scrollTop = 0"); await page.wait_for_timeout(100)
            await ev(page, 'pointerdown', 31, 'touch', 600, 700)
            for i in range(1, 9): await ev(page, 'pointermove', 31, 'touch', 600, 700 - i * 35); await page.wait_for_timeout(8)
            await ev(page, 'pointerup', 31, 'touch', 600, 420); await page.wait_for_timeout(700)
            check('one-finger scroll', await J(page, "document.getElementById('scroller').scrollTop") > 200)
            s0 = await J(page, '__margin.E.s')
            await ev(page, 'pointerdown', 51, 'touch', 550, 500); await ev(page, 'pointerdown', 52, 'touch', 650, 500)
            for i in range(1, 9): await ev(page, 'pointermove', 51, 'touch', 550 - i * 10, 500); await ev(page, 'pointermove', 52, 'touch', 650 + i * 10, 500)
            await ev(page, 'pointerup', 51, 'touch', 470, 500); await ev(page, 'pointerup', 52, 'touch', 730, 500); await page.wait_for_timeout(300)
            check('pinch zoom', await J(page, '__margin.E.s') > s0 * 2)
            await page.keyboard.press('Control+0'); await page.wait_for_timeout(200)

            # ---------- PDF: drop into open note, export ----------
            n_pages = await J(page, '__margin.E.pages.length')
            await drop_file(page, '#scroller', pdf_b64, 'Slides.pdf', 'application/pdf'); await page.wait_for_timeout(3500)
            check('drop PDF into note adds pages', await J(page, '__margin.E.pages.length') == n_pages + 3)
            await page.click('#ed-more'); await page.click('.pop .mi:has-text("Export as PDF")')
            await page.wait_for_selector('.modal .btn.primary:has-text("Download")', timeout=20000)
            async with page.expect_download() as dl: await page.click('.modal .btn.primary')
            out = SHOTS / 'export.pdf'; await (await dl.value).save_as(str(out))
            data = out.read_bytes()
            check('export PDF', data.startswith(b'%PDF') and data.count(b'/Type /Page ') == n_pages + 3, f'{len(data)} bytes')
            await page.screenshot(path=str(SHOTS / 'editor.png'))
            await page.click('#ed-back'); await page.wait_for_timeout(800)

            # ---------- import chooser: existing + new ----------
            await drop_file(page, '#grid', pdf_b64, 'Ch2.pdf', 'application/pdf')
            await page.wait_for_selector('.dest-row'); await page.fill('.dest-q', 'other'); await page.click('.dest-row'); await page.wait_for_timeout(3500)
            check('import into existing note', await J(page, '__margin.E.note.title') == 'Other note' and await J(page, '__margin.E.pages.length') == 4)
            await page.click('#ed-back'); await page.wait_for_timeout(700)
            await page.click('#btn-import')
            async with page.expect_file_chooser() as fc: await page.click('.pop .mi:has-text("Choose from Files")')
            await (await fc.value).set_files(str(FIX / 'sample.pdf')); await page.wait_for_selector('.dest-new'); await page.click('.dest-new'); await page.wait_for_timeout(3500)
            check('import as new note', await J(page, '__margin.E.note.title') == 'sample' and await J(page, '__margin.E.pages.length') == 3)
            await page.click('#ed-back'); await page.wait_for_timeout(700)

            # ---------- feedback form (if present) ----------
            if await J(page, "!!document.getElementById('btn-feedback')"):
                await page.click('#btn-feedback'); await page.wait_for_timeout(200)
                configured = await J(page, "!!document.querySelector('.modal .fb-form')")
                if configured: check('feedback form shows one-idea tip', await J(page, "!!document.querySelector('.modal .fb-tip')"))
                check('feedback dialog opens', configured or await J(page, "(document.querySelector('.modal h3')||{}).textContent==='Feedback isn’t set up yet'"))
                if configured:
                    await page.fill('.fb-title', 'Bug title'); await page.fill('.fb-desc', 'Bug details')
                    await page.click('.fb-kind [data-k="feature"]')
                    blank = await J(page, "[document.querySelector('.fb-title').value, document.querySelector('.fb-desc').value]") == ['', '']
                    await page.fill('.fb-title', 'Idea title')
                    await page.click('.fb-kind [data-k="bug"]')
                    bug_back = await J(page, "[document.querySelector('.fb-title').value, document.querySelector('.fb-desc').value]") == ['Bug title', 'Bug details']
                    await page.click('.fb-kind [data-k="feature"]')
                    feat_back = await J(page, "document.querySelector('.fb-title').value") == 'Idea title'
                    check('feedback: bug and feature keep separate drafts', blank and bug_back and feat_back)
                    await page.fill('.fb-title', '')
                    await page.click('.modal .mbtns .btn.primary'); await page.wait_for_timeout(300)
                    check('feedback: error shows once, as the red line only', await J(page, "!document.querySelector('.fb-err').hidden && !document.getElementById('toast').classList.contains('show')"))
                    await page.screenshot(path=str(SHOTS / 'feedback-error.png'))
                await page.click('.modal .btn:has-text("Cancel")' if configured else '.modal .btn:has-text("OK")')

            # ---------- persistence ----------
            await page.reload(); await page.wait_for_timeout(900)
            check('data survives reload', await J(page, '[__margin.L.notes.length, __margin.L.folders.length]') == [3, 1])
            await page.screenshot(path=str(SHOTS / 'library.png'))
        except Exception as e:
            check('test run completed', False, repr(e)[:300])
        await b.close()
    httpd.shutdown()
    check('no page errors', not errors, '; '.join(errors)[:400])
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    asyncio.run(main())
