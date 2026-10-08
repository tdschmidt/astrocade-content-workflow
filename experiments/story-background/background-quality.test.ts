import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ProgressionReviewSchema,assertProgressionReview} from './background-quality.js';
const span=(start:number,end:number,sectionId:string,attemptId='run-one')=>({start,end,sectionId,attemptId,outcome:'progress',evidence:'The player clears new obstacles and reaches the next route section.'});
const review=(spans:unknown[])=>ProgressionReviewSchema.parse({decision:'accept',watchedWholeSelection:true,engagementSummary:'Changing obstacles and successful dodges maintain forward momentum.',repeatedFailureLoop:false,spans});
test('accepts continuous play or a montage that advances through new situations',()=>{
 assert.doesNotThrow(()=>assertProgressionReview(review([span(0,40,'runner-route')]),40));
 assert.doesNotThrow(()=>assertProgressionReview(review([span(0,20,'stairs'),span(20,40,'moving-platforms','run-two')]),40));
});
test('rejects fresh recordings of the same failed section even if each excerpt looks successful',()=>assert.throws(()=>assertProgressionReview(review([span(0,20,'first-stairs','attempt-a'),span(20,40,'first-stairs','attempt-b')]),40),/Repeated attempt/));
test('requires a whole-selection review and rejects flagged failure loops',()=>{const r=review([span(0,40,'runner-route')]);assert.throws(()=>assertProgressionReview({...r,watchedWholeSelection:false},40),/whole-selection/);assert.throws(()=>assertProgressionReview({...r,repeatedFailureLoop:true},40),/whole-selection/);assert.throws(()=>assertProgressionReview({...r,decision:'reject'},40),/whole-selection/);});
test('rejects incomplete review coverage and selected failed movement',()=>{assert.throws(()=>assertProgressionReview(review([span(0,10,'route'),span(15,40,'route')]),40),/without gaps/);assert.throws(()=>assertProgressionReview(review([span(0,10,'route')]),40),/complete background/);const r=review([span(0,40,'route')]);r.spans[0]!.outcome='retry';assert.throws(()=>assertProgressionReview(r,40),/failed attempts/);});
