"""Reproducible, local-only feature montage with exact original-frame provenance."""
import hashlib,json,pathlib,subprocess
R=pathlib.Path(__file__).resolve().parents[2]
OUT=R/'data/experiments/game-overview/ben10-source-v2'
OUT.mkdir(parents=True,exist_ok=False)
old=R/'data/runs/2026-10-07T20-05-22-590Z-3e1980/game-01M32NFPAH709Z7CT0YXSTM73W/0f3e2631-be89-474c-ae2f-59169f19a6e8.webm'
new=R/'data/runs/2026-10-07T20-17-46-165Z-8db772/game-01M32NFPAH709Z7CT0YXSTM73W/ef454cd0-ff3e-4083-a6db-ab37fbc18013.webm'
clips=[('flight',new,237.9,245.4),('wall',old,191.333333333,197.333333333),('blades',old,220.8,228.3),('burrow',old,305.833333333,312.833333333)]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
hashes={str(p):sha(p) for p in [old,new]}
manifest={'kind':'derived gameplay montage','fps':30,'policy':'Original silent gameplay, hard cuts only. No invented action, interpolation, duplicated windows, captions, music or game-name overlay. Original captures can be nonchronological; this is an overview montage, not a continuous mission. Paths and hashes identify exact originals.','clips':[]}
offset=0
for name,src,start,end in clips:
 frames=round((end-start)*30);p=OUT/f'{name}.mp4'
 args=['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','error','-nostdin','-n','-ss',str(start),'-i',str(src),'-an','-vf','fps=30,setsar=1','-frames:v',str(frames),'-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p',str(p)]
 subprocess.run(args,check=True)
 manifest['clips'].append({'id':name,'originalPath':str(src),'originalSha256':hashes[str(src)],'originalStart':start,'originalEnd':end,'derivedStart':offset,'derivedEnd':offset+frames/30,'frameCount':frames,'preparedPath':str(p),'preparedSha256':sha(p),'command':args})
 offset+=frames/30
(OUT/'concat.txt').write_text(''.join(f"file '{c['id']}.mp4'\n" for c in manifest['clips']))
source=OUT/'ben10-feature-source.mp4'
subprocess.run(['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','error','-nostdin','-n','-f','concat','-safe','1','-i',str(OUT/'concat.txt'),'-c','copy',str(source)],check=True)
manifest.update({'derivedPath':str(source),'derivedSha256':sha(source),'durationSeconds':offset})
(OUT/'provenance.json').write_text(json.dumps(manifest,indent=2)+'\n')
ledger={'gameTitle':'BEN 10 OPEN World','gameUrl':'https://www.astrocade.com/games/ben-10-open-world/01M32NFPAH709Z7CT0YXSTM73W','sourcePath':str(source.relative_to(R)),'sourceSha256':manifest['derivedSha256'],'sourceProvenance':str((OUT/'provenance.json').relative_to(R)),'selectionReason':'Three visually reviewed candidate games: Ben10 has flight across a city, selectable forms, constructed crystal walls, extending blades and burrow traversal. These demonstrated choices are richer than the available single placement loop in Sort It Out or repeated taps/appearance tiers in Muscle Mommy Clicker.','wordRange':[80,95],'crop':{'x':30,'y':0,'width':660,'height':1176},'captionSafety':'Initial selection: upper-middle y320 is above central bodies and below the top HUD; verify full-resolution output because the crystal tips extend high. Lower-middle y960 would cover burrow mound and flight exhaust. No permanent title/author/credit.','chapters':[
{'id':'flight','allowedStart':0,'allowedEnd':7.5,'framing':'Start exactly at0; rising through the city is already beginning. Keep the street-to-rooftop ascent; first-second picture supports a specific curiosity hook.','facts':[{'id':'heatblast-flight','fact':'Heatblast rises past a tall building and travels above streets/houses with a bright continuous flame trail beneath him. No target, impact, landing or obstacle goal is demonstrated.'},{'id':'game-context','fact':'This is the recorded BEN 10 OPEN World game. These are sampled abilities from two sessions, not a continuous mission.'}]},
{'id':'crystal-wall','allowedStart':7.5,'allowedEnd':13.5,'framing':'Keep the unobstructed Diamondhead body followed by the wall activation within the first second. Native selection menu is intentionally omitted because CLICK TO AIM obstructed it; do not narrate the click/selection as though it occurs in this shot.','facts':[{'id':'diamond-wall','fact':'At derived8.3–8.5s, tall cyan-and-white crystal pillars rise around Diamondhead into a persistent enclosure. The footage does not demonstrate blocking an enemy.'}]},
{'id':'blades','allowedStart':13.5,'allowedEnd':21,'framing':'Keep raised blade extension around15.1–16.6s. Projectile/block debris near end does not prove a hit.','facts':[{'id':'diamond-blades','fact':'Diamondhead extends two long crystal blades from his arms, raising and lowering them. No opponent or successful target hit is shown.'}]},
{'id':'burrow','allowedStart':21,'allowedEnd':28,'framing':'Keep visible Wildvine body at start, change to mound by21.5, then movement through scattered colored blocks through~25.3. Do not claim travel beneath the city because this shot is a gray open lot.','facts':[{'id':'wildvine-burrow','fact':'Wildvine changes from a standing multi-legged green alien into a low brown mound with a pale ring. That mound moves across the ground past scattered blocks. This is an active burrow traversal demonstration; emergence is outside the selected shot.'},{'id':'different-powers','fact':'The displayed overview shows three selectable alien forms with different demonstrated abilities: Heatblast flight, Diamondhead crystal enclosure/blades, Wildvine burrow movement.'}]}],
'forbiddenClaims':['Defeating enemies, escaping danger or winning a mission','Ability unlocks, leveling or progression not shown','All ten aliens or all powers demonstrated','Combat effectiveness or protective strength inferred from HUD','Flight or burrowing solves a required obstacle','Personal playtime or firsthand enjoyment','Platformwide rank or verified play count inferred from an unlabeled card counter']}
(R/'experiments/game-overview/sources/ben10.json').write_text(json.dumps(ledger,indent=2)+'\n')
print(json.dumps({'source':str(source),'ledger':'experiments/game-overview/sources/ben10.json','durationSeconds':offset}))
