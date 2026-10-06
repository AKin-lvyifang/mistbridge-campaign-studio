/** Conservative accidental-secret guard. Detection errors never quote the matched text. */
export const CREDENTIAL_WARNING='检测到疑似 API 密钥，内容已清除且未发送。请只在本地密钥设置中输入新密钥。';
export function looksLikeCredential(value:string):boolean{
  return /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)
    || /\bBearer\s+[A-Za-z0-9_.-]{16,}\b/i.test(value)
    || /\b(?:api[_ -]?key|access[_ -]?token|secret[_ -]?key)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i.test(value);
}
