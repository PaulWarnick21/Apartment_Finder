export type RatingStatus='pending'|'reviewing'|'reviewed'|'applied'|'failed'|'reverted'|'needs-attention';
export type RatingReview={summary:string;interpretation:string;unresolved?:string[];changes:{parameter:string;value:number;reason:string}[];outcome:string;beforeError:number;afterError:number;examples:number};
export type RatingFeedback={id:number;homeId:number;at:string;userScore:number;appScore:number;reason:string;status:RatingStatus;review:RatingReview|null;error:string;origin:'app'|'chat';canUndo:boolean;calibrationApplied?:boolean};
