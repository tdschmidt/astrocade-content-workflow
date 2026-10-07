import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EditPlanSchema,validateEditPlan} from './schema.js';
import {payoffEndingIssues} from './payoff-ending.js';
const plan=(end:number)=>EditPlanSchema.parse({version:1,id:'fixture',title:'Payoff fixture',style:'troll-freeze',sourcePath:'unused.mp4',segments:[{kind:'clip',start:0,end}],music:{asset:'troll',dropAt:15.77},rationale:'In-memory test only'});
test('rejects the abrupt roughly two-second post-drop ending',()=>assert.match(payoffEndingIssues(plan(18.1)).join(' '),/at least 4s/));
test('allows a musical tail longer than the old five-second cap',()=>assert.deepEqual(payoffEndingIssues(plan(21.77)),[]));
test('climax synchronization validation also allows a six-second musical resolution',()=>{
 const p=plan(21.77);
 p.segments=[{kind:'clip',start:0,end:15.77,speed:1,visual:'clean',zoom:1},{kind:'clip',start:15.77,end:21.77,speed:1,visual:'bw',zoom:1}];
 p.punches=[{at:15.77,duration:.2,strength:.8}];
 p.narrativeBeats={candidates:[{sourceAt:2,significance:'An earlier smaller reaction.',rank:2},{sourceAt:15.77,significance:'The decisive observed reversal.',rank:1}],setup:{sourceAt:1,description:'A readable clean setup.'},escalation:{sourceAt:14,description:'The attack escalates the stakes.'},climax:{segmentIndex:1,sourceAt:15.77,outputAt:15.77,visualSegmentIndex:1,punchIndex:0,reason:'The real reversal resolves the setup and attack.'},result:{sourceAt:20,description:'The surviving character keeps moving.'},tailReason:'The moving aftermath supports a full musical phrase.',latePayoffException:''};
 assert.doesNotThrow(()=>validateEditPlan(p,22));
 assert.deepEqual(payoffEndingIssues(p),[]);
});
test('cannot satisfy breathing room with a long frozen tail alone',()=>{const p=plan(17);p.segments.push({kind:'freeze',at:17,duration:2,visual:'bw',zoom:1},{kind:'freeze',at:17,duration:2,visual:'bw',zoom:1});assert.match(payoffEndingIssues(p).join(' '),/moving aftermath/);});
