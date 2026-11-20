/** Read a single advertised count from one search card; ranges stay unknown. */
export function discoveryBedrooms(input:string):number|null{
 const text=input.replace(/[\u2010-\u2015\u2212]/g,'-');
 const number='(?:\\d+|zero|one|two|three|four|five|six|seven|eight|nine)';
 const label='(?:bedrooms?|beds?|br|bd|bdr(?:m)?s?)';
 if(new RegExp('\\b'+number+'\\s*(?:-|to|or|and|/|,)\\s*'+number+'\\s*[- ]?'+label+'\\b','i').test(text)
  ||new RegExp('\\b'+number+'\\s*\\+\\s*'+label+'\\b','i').test(text)
  ||new RegExp('\\bstudio\\s*(?:-|to|or|and|/|,)\\s*'+number+'\\s*[- ]?'+label+'\\b','i').test(text))return null;
 const words:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9};
 const values=[...new Set([...text.matchAll(new RegExp('(?<![\\d.])\\b('+number+')\\s*[- ]?'+label+'\\b','gi'))].map(m=>words[m[1].toLowerCase()]??Number(m[1])))];
 return values.length===1?values[0]:null;
}
