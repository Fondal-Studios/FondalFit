import {describe,it,expect} from 'vitest';
import {weeklyDecision} from '../src/weekly';
const base={planned:4,completed:4,lastSessionDaysAgo:1,fatigue:3,pain:1,sleepHours:8,choice:'strong' as const};
describe('weekly evidence and return to exercise',()=>{
 it('allows mild progression only with recovered and adherent athlete',()=>expect(weeklyDecision(base)).toMatchObject({factor:1.05,reason:'athlete_choice'}));
 it('blocks intense option with high fatigue',()=>expect(weeklyDecision({...base,fatigue:9})).toMatchObject({mode:'recovery',factor:0.7,reason:'recovery_warning'}));
 it('blocks intense option with pain',()=>expect(weeklyDecision({...base,pain:8})).toMatchObject({factor:0.7,reason:'recovery_warning'}));
 it('prescribes gradual return after gap, without calling no record nonadherence',()=>expect(weeklyDecision({...base,completed:0,lastSessionDaysAgo:17})).toMatchObject({mode:'recovery',factor:0.7,absenceStatus:'unknown_or_unrecorded'}));
 it('does not infer strong progress with no fatigue records',()=>expect(weeklyDecision({...base,fatigue:null})).toMatchObject({factor:1,reason:'strong_requires_data'}));
});
