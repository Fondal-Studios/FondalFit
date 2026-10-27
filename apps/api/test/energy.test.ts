import {describe,it,expect} from 'vitest';
import {computeEnergyDay,weeklyBalance,localDate} from '../src/energy';
describe('energy calculations',()=>{
 it('does not double-count habitual exercise',()=>{const a=computeEnergyDay({bmr:1500,activity:1.55,intake:2200,extraActiveKcal:0,complete:true});const b=computeEnergyDay({bmr:1500,activity:1.55,intake:2200,extraActiveKcal:500,complete:true});expect(a.balance).toBe(b.balance);expect(b.exerciseReported).toBe(500);});
 it('never labels incomplete days deficit',()=>{expect(computeEnergyDay({bmr:1600,activity:1.2,intake:200,extraActiveKcal:600,complete:false})).toMatchObject({balance:null,band:'unknown'});});
 it('does not aggregate incomplete weeks',()=>{const dates=Array.from({length:7},(_,i)=>({date:`2026-10-${String(19+i).padStart(2,'0')}`,complete:i!==3,balance:-100}));expect(weeklyBalance(dates)[0]).toMatchObject({complete:false,balance:null,days:6});});
 it('aggregates only seven confirmed distinct days',()=>{const dates=Array.from({length:7},(_,i)=>({date:`2026-10-${String(19+i).padStart(2,'0')}`,complete:true,balance:-100}));expect(weeklyBalance(dates)[0]).toMatchObject({complete:true,balance:-700,days:7});});
 it('local calendar date honors UTC offsets across midnight',()=>{expect(localDate('2026-10-27T01:00:00.000Z',180)).toBe('2026-10-26');expect(localDate('2026-10-26T23:30:00.000Z',-180)).toBe('2026-10-27');});
});
