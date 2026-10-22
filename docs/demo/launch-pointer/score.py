"""Original event-aligned sound. No third-party samples or music."""
import json, wave, os
from pathlib import Path
import numpy as np
from scipy.signal import fftconvolve
BASE=Path(os.environ.get('POINTER_OUTPUT',Path(__file__).resolve().parents[3]/'demo-output'/'agent-replay-pointer-release'))
BASE.mkdir(parents=True,exist_ok=True)
SR=48000;DUR=24;N=SR*DUR
rng=np.random.default_rng(20261022)
music=np.zeros((N,2));fx=np.zeros((N,2));events=[]
def add(at,sig,pan=0,stem=fx,name=None):
    start=round(at*SR);n=min(len(sig),N-start)
    if n<=0:return
    stem[start:start+n]+=np.column_stack((sig[:n]*np.sqrt((1-pan)/2),sig[:n]*np.sqrt((1+pan)/2)))
    if name:events.append({'t':at,'name':name,'pan':pan})
def wood(amp=.08):
    t=np.arange(round(.14*SR))/SR
    return amp*(np.sin(2*np.pi*870*t)+.28*np.sin(2*np.pi*1360*t))*np.exp(-t*60)
def bell(f,amp=.05,d=.6):
    t=np.arange(round(d*SR))/SR
    return amp*(1-np.exp(-t*600))*np.exp(-t*7/d)*(np.sin(2*np.pi*f*t)+.15*np.sin(2*np.pi*2.003*f*t))
def kick(amp=.15):
    t=np.arange(round(.3*SR))/SR
    return amp*np.sin(2*np.pi*(48*t+60*(1-np.exp(-30*t))/30))*np.exp(-t*16)
def air(d=.6,amp=.03):
    t=np.arange(round(d*SR))/SR
    noise=np.convolve(rng.normal(0,1,len(t)),np.ones(14)/14,'same')
    return amp*noise*np.sin(np.pi*t/d)**2
# A single restrained 120bpm motif, punctuated by explicit quiet holds.
for at in np.arange(.5,21.1,.5):
    if any(a<=at<b for a,b in [(3.8,5.5),(9,11.5),(15.6,17),(18.5,20)]):continue
    i=round(at*2);add(at,kick(.13 if i%2 else .18),stem=music)
    add(at,bell([130.81,164.81,196,164.81][i%4],.055,.4),stem=music)
    if at<2:add(at+.25,wood(.025),pan=.4,stem=music)
# Typing is a material gesture, not a melody for every letter.
for i in range(12):add(.32+i*.105,wood(.018),pan=-.55+i*.08)
for at,name,pan in [(2.35,'press replay',.5),(3.32,'failure lands',.2),(5.85,'grip timeline',.1),(7.65,'release timeline',-.35),(10,'inspect comparison',.35),(11.65,'comparison restored',.4),(12.2,'direction revealed',.4),(13.4,'replay test history',-.5),(20,'grip window',.5)]:
    add(at,wood(.09),pan,name=name)
for at,d,name in [(2.4,.65,'window unfolds'),(5.85,1.8,'timeline drag'),(7.95,.77,'playhead opens edit'),(13.42,.83,'underline opens test'),(16.95,.9,'result rule opens product'),(20,1.25,'window folds')]:add(at,air(d,.07),name=name)
add(3.32,kick(.27),name='regression weight')
add(3.85,air(.55,.04),pan=.35,name='reaction close-up')
for i,at in enumerate([.61,.96,1.31,1.66]):add(at,wood(.027),pan=-.5+i*.27,name='little footsteps')
add(11.55,bell(783.99,.023,.35),pan=.35,name='eyes find the clue')
add(12.2,bell(392,.035,.25),pan=.3,name='edit insight')
add(14.98,air(.22,.07),pan=.4,name='joy leap')
add(15.63,wood(.07),pan=.4,name='soft landing')
add(16.06,wood(.035),pan=.4,name='little second landing')
for f in [329.63,493.88,659.25]:add(15,bell(f,.065,1.0),name='recovered chord')
for f in [261.63,329.63,392,523.25]:add(21.4,bell(f,.07,1.8),name='brand chord')
add(20.65,wood(.05),pan=.5,name='edge dot becomes token')
add(20.65,air(.75,.045),pan=.25,name='carry token home')
# One short shared room impulse; same material space for every foley cue.
ir=np.zeros(round(SR*.35));ir[0]=1
for at,amp in [(.019,.12),(.037,.09),(.071,.06),(.113,.035)]:ir[round(at*SR)]=amp
for ch in range(2):fx[:,ch]=fftconvolve(fx[:,ch],ir)[:N]
clock=np.arange(N)/SR;duck=np.ones(N)
for event in events:duck*=1-.25*np.exp(-((clock-event['t'])/.12)**2)
music*=duck[:,None]
mix=fx+music
peak=float(np.abs(mix).max());gain=min(2,.53/max(peak,1e-9));mix*=gain;music*=gain;fx*=gain
fade=np.ones(N);fade[:960]=np.linspace(0,1,960);fade[-24000:]=np.linspace(1,0,24000)
def write(name,data):
    with wave.open(str(BASE/name),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((data*fade[:,None]*32767).astype('<i2').tobytes())
write('soundtrack.wav',mix);write('music-stem.wav',music);write('effects-stem.wav',fx)
(BASE/'audio-events.json').write_text(json.dumps({'sampleRate':SR,'duration':DUR,'events':events,'peakDBFS':20*np.log10(np.abs(mix).max()+1e-12),'originalSynthesis':True},indent=2))
print(f'24s original score, {len(events)} cues, peak {20*np.log10(np.abs(mix).max()+1e-12):.2f} dBFS')
