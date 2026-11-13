from PIL import Image, ImageDraw
def make(size, path, rounded=False):
    S=1024
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    # gradient background
    bg=Image.new('RGBA',(S,S))
    for y in range(S):
        t=y/S; c=(int(58+(31-58)*t),int(103+(63-103)*t),int(238+(166-238)*t),255)
        ImageDraw.Draw(bg).line([(0,y),(S,y)],fill=c)
    mask=Image.new('L',(S,S),0); ImageDraw.Draw(mask).rounded_rectangle([0,0,S,S],radius=230 if rounded else 0,fill=255)
    im.paste(bg,(0,0),mask)
    # paper
    d.rounded_rectangle([250,190,774,834],radius=42,fill=(255,255,255,255))
    for y in range(330,780,78): d.line([(300,y),(724,y)],fill=(170,190,225,255),width=10)
    # ink stroke
    pts=[(318,560),(360,500),(400,470),(430,500),(440,560),(470,600),(520,560),(560,470),(600,440),(640,480),(660,560),(700,590)]
    d.line(pts,fill=(28,28,30,255),width=26,joint='curve')
    for p in (pts[0],pts[-1]): d.ellipse([p[0]-13,p[1]-13,p[0]+13,p[1]+13],fill=(28,28,30,255))
    # highlighter band
    hl=Image.new('RGBA',(S,S),(0,0,0,0)); ImageDraw.Draw(hl).rectangle([300,640,640,690],fill=(255,225,77,170))
    im=Image.alpha_composite(im,hl)
    im.resize((size,size),Image.LANCZOS).save(path)
make(192,'dist/icon-192.png',True); make(512,'dist/icon-512.png',True); make(180,'dist/apple-touch-icon.png',False)
