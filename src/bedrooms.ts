import type {Listing} from './domain';

/** Only the advertised unit title qualifies; tours, amenities and building copy do not. */
export function studioTitleEvidence(title:string){
 if(/\b(?:not|isn't|is not)\s+(?:a\s+)?studio\b|\bstudio[- ](?:style|city)\b|\b(?:yoga|fitness|dance|art|music|recording|sample|guest)\s+studio\b/i.test(title))return undefined;
 if(/\b(?:[1-9]\d*|one|two|three)\s*[- ]?(?:bedrooms?|beds?|br)\b/i.test(title))return undefined;
 return /\bstudio\b|\bbachelor\s+(?:apartment|suite|unit)\b/i.test(title)?title.trim():undefined;
}

export function correctStudioBedrooms(listing:Listing):Listing{
 const evidence=studioTitleEvidence(listing.title);
 return evidence?{...listing,beds:0,evidence:{...listing.evidence,bedrooms:`Studio explicitly advertised in the unit title: ${evidence}`}}:listing;
}
