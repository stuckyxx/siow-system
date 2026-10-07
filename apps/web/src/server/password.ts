/**
 * Hash de senha (scrypt, node:crypto). A implementação vive em `@siow/db`
 * (packages/db/src/password.ts) para que o seed e a aplicação usem o mesmo formato.
 */
export { hashPassword, verifyPassword, isStrongPassword } from '@siow/db';
