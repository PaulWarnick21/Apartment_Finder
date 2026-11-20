/** Local authorization boundaries are not website/transport failures. */
export function isLocalScanStop(error:unknown){
 const message=error instanceof Error?error.message:String(error);
 return /^(?:(?:Per-source )?(?:pages?|listings|photos|aiCalls|requests|reservedUsd|AI) cap reached(?:; (?:remaining work|photo review) deferred)?|Local request allowance reached; remaining work deferred|Scan deadline reached; remaining work retained|Scan stopped)$/.test(message);
}
