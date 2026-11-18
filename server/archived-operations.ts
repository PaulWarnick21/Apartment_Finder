/** Historical run records are evidence, never authorization for another operation. */
export function assertArchivedOperation(name:string,action:string|undefined,readOnlyActions:readonly string[]=[]):void{
 if(action!==undefined&&readOnlyActions.includes(action))return;
 const available=readOnlyActions.length?` Only ${readOnlyActions.join(', ')} remains available.`:'';
 throw new Error(`${name} is archived; historical authorization cannot be reused.${available} Prepare a current bounded plan and obtain fresh approval before new work.`);
}
