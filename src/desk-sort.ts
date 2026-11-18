import {quickGrades,type Home} from './domain';
const gradePosition=(home:Home)=>{
 const position=home.quickRank?quickGrades.indexOf(home.quickRank.grade):-1;
 return position<0?quickGrades.length:position;
};
export function compareHomes(a:Home,b:Home,tab:string,sort:string){
 if(tab==='Excluded'||tab==='Closed')return Date.parse(b.categoryEnteredAt??b.firstSeen)-Date.parse(a.categoryEnteredAt??a.firstSeen)||b.id-a.id;
 if(sort==='rent')return (a.listing.rent??Infinity)-(b.listing.rent??Infinity)||b.id-a.id;
 if(sort==='recent')return b.id-a.id;
 // Keep unfinished assessments in queue order, independent of provisional scores.
 if(tab==='Scoring in Progress')return Date.parse(a.categoryEnteredAt??a.fullReview?.updatedAt??a.firstSeen)-Date.parse(b.categoryEnteredAt??b.fullReview?.updatedAt??b.firstSeen)||a.id-b.id;
 // Quick ranks are an intake priority, independent of the hidden full-score ceiling.
 if(tab==='Unreviewed'&&(a.quickRank||b.quickRank))return gradePosition(a)-gradePosition(b)||(b.quickRank?.rankValue??-Infinity)-(a.quickRank?.rankValue??-Infinity)||b.id-a.id;
 return b.score.value-a.score.value||b.id-a.id;
}
