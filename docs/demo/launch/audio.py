"""Original procedural stereo score. No external music/sample assets."""
from pathlib import Path
import json,wave,os
import numpy as np
SOURCE=Path(__file__).resolve().parent
BASE=Path(os.environ.get('LAUNCH_OUTPUT',SOURCE.parents[2]/'demo-output'/'agent-replay-launch-final'));BASE.mkdir(parents=True,exist_ok=True)
T=json.loads((SOURCE/'timeline.json').read_text());SR=48000
N=round(T['duration']*SR);music=np.zeros((N,2));fx=np.zeros((N,2));rng=np.random.default_rng(86)
log=[]
def add(at,sig,gain=1,pan=0,stem=fx,name=''):
    start=round(at*SR);n=min(len(sig),N-start)
    if n<=0:return
    pan=float(np.clip(pan,-1,1));st=np.column_stack((sig[:n]*np.sqrt((1-pan)/2),sig[:n]*np.sqrt((1+pan)/2)))
    stem[start:start+n]+=gain*st
    if name:log.append({'event':name,'seconds':float(round(at,4)),'sample':int(start),'pan':pan})
def bell(freq,dur=.5,amp=.1):
    x=np.arange(round(SR*dur))/SR
    env=(1-np.exp(-x/.004))*np.exp(-x*6/dur)
    return amp*env*(np.sin(2*np.pi*freq*x)+.16*np.sin(2*np.pi*freq*2.001*x))
def kick(amp=.18):
    x=np.arange(round(SR*.35))/SR
    phase=2*np.pi*(48*x+70*(1-np.exp(-24*x))/24)
    return np.sin(phase)*np.exp(-14*x)*amp

def tick(amp=.04):
    x=np.arange(round(SR*.045))/SR
    return (rng.uniform(-1,1,len(x))*.45+np.sin(x*2*np.pi*1900)*.55)*np.exp(-x*140)*amp

def sweep(dur=.55,amp=.05,reverse=False):
    x=np.arange(round(SR*dur))/SR
    n=rng.normal(0,1,len(x));n=np.convolve(n,np.ones(11)/11,'same')
    env=np.sin(np.pi*x/dur)**2
    sig=n*env*amp+np.sin(2*np.pi*(130*x+700*x*x/(2*dur)))*env*amp*.15
    return sig[::-1] if reverse else sig
# False ending and entry, retaining the same small sonic motif.
for f,a in [(523.25,.07),(659.25,.045),(783.99,.035)]:add(T['done']+.03,bell(f,1,a),name='done')
add(T['ink'],bell(65,.6,.11),name='period wakes')
add(T['portal'],sweep(T['entered']-T['portal'],.08,True),name='enter period')
# A real short reduction just before the event world appears.
beat=60/112
for i,at in enumerate(np.arange(T['flow'],T['failure']-.22,beat)):
    add(at,kick(.16),stem=music)
    add(at,bell([110,146.83,164.81,130.81][i%4],.48,.08),stem=music)
    add(at+beat/2,tick(.025),pan=(-.5 if i%2 else .5),stem=music)
for i in range(7):add(T['flow']+.22+i*.26,tick(.027),pan=-.7+i*.23,name='event passes')
add(T['failure'],kick(.27),name='failure locks');add(T['failure'],bell(55,.7,.15),name='failure unresolved')
for i in range(3):
    at=T['backtrack']+(T['edit']-T['backtrack'])*(i+1)/3
    add(at,tick(.047),pan=.5-i*.5,name='backtrack node')
add(T['edit'],sweep(.45,.05,True),name='edit unfolds')
add(6.22,tick(.018),name='character turns back')
add(9.65,tick(.018),name='character checks again')
add(T['replay'],tick(.05),name='scrub to edit beginning')
add(T['insert']+.14,tick(.09),name='equals inserted')
add(T['insert']+.14,bell(82.4,.4,.075),name='wrong edit')
add(T['correct']+.15,tick(.06),name='equals removed')
add(T['direction']+.14,tick(.07),name='True to False')
add(T['rerun'],sweep(.4,.04),name='test rerun')
# Recovery cue; the opening chord is the earlier false ending.
for f,a in [(329.63,.08),(493.88,.05),(659.25,.045)]:add(T['passed'],bell(f,1.0,a),name='tests passed')
for at,name,pan in [(T['reported']+.45,'reported',-.45),(T['actual']+.45,'actual',.45),(T['align'],'align',0),(T['verified']+.3,'verified',0)]:
    add(at,tick(.055),pan=pan,name=name)
    add(at,bell(660 if name=='verified' else 440,.34,.045),pan=pan)
add(T['product'],sweep(.8,.06),name='line becomes player')
# Quiet continuation under the real product, not a new song.
for i,at in enumerate(np.arange(T['productOpen'],T['cta'],beat)):
    add(at,kick(.09),stem=music)
    add(at,bell([110,164.81,146.83,130.81][i%4],.6,.045),stem=music)
add(T['cta'],sweep(.7,.06),name='cursor leaves player')
for f,a in [(261.63,.08),(329.63,.065),(392,.05),(523.25,.03)]:add(T['cta']+1.4,bell(f,2.6,a),name='brand resolves')
# A restrained midrange bed carries the quiet inspection passages on small speakers.
# Keep the half-second reaction soft; no new melodic theme.
clock=np.arange(N)/SR
bed=(np.sin(2*np.pi*220*clock)+.35*np.sin(2*np.pi*330*clock))*.0035
bed*=np.clip((clock-5.6)/.5,0,1)*np.clip((T['productOpen']-clock)/.8,0,1)
duck=1-.9*np.exp(-((clock-6.13)/.24)**6)
bed*=duck
music[:,0]+=bed;music[:,1]+=bed*.93
# Match the 0.3–1.25s approach to the screen without changing the melody.
# Distant opening is slightly softer and less bright; full detail returns on entry.
m=round(1.25*SR);phase=np.arange(m)/SR
far=1-np.clip((phase-.3)/.95,0,1);kernel=np.ones(21)/21
for stem in (music,fx):
    for channel in range(2):
        dry=stem[:m,channel].copy();soft=np.convolve(dry,kernel,'same')
        stem[:m,channel]=dry*(1-far)+soft*.84*far
# Avoid a hard splice or a clipped ending.
mix=music+fx
fade=np.ones(N);k=round(.025*SR);fade[:k]=np.linspace(0,1,k);k=round(.7*SR);fade[-k:]=np.linspace(1,0,k)
mix*=fade[:,None]
peak=max(abs(mix).max(),1e-6);gain=.84/peak
for name,data in [('soundtrack.wav',mix*gain),('music-stem.wav',music*gain*fade[:,None]),('effects-stem.wav',fx*gain*fade[:,None])]:
    with wave.open(str(BASE/name),'wb') as w:
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((np.clip(data,-1,1)*32767).astype('<i2').tobytes())
report={'sampleRate':SR,'channels':2,'duration':T['duration'],'samplePeakDbFS':float(20*np.log10(max(abs(mix*gain).max(),1e-9))),'rmsDbFS':float(20*np.log10(np.sqrt(np.mean((mix*gain)**2)))),'events':log,'allOriginal':True,'source':'timeline.json'}
(BASE/'audio-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k!='events'}))
