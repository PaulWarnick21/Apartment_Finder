import test from 'node:test';
import assert from 'node:assert/strict';
import {apartmentSummary} from '../src/apartment-summary.ts';
import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {scoreListing} from '../server/scoring.ts';
test('summary preserves view and furnishing uncertainty instead of inferring from staged photos',()=>{const listing=listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.com/1',title:'Example',address:'Example',rent:2500,beds:1,furnished:true,description:'Photos show a staged apartment.',photos:[{id:'1',url:'https://example.com/p',status:'reviewed',kind:'interior',scenery:'nature',unitCertain:false,quality:5}],galleryComplete:true});const summary=apartmentSummary({listing,score:scoreListing(listing,criteriaSchema.parse({}))});assert.match(summary,/specific apartment’s windows is not confirmed/);assert.ok(!summary.includes('included furniture'));assert.match(summary,/\$2,500 per month/);assert.match(summary,/Still to confirm/);});
