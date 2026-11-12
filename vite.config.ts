import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: 'dist' }, server: { host: '127.0.0.1', fs: {deny:['.env','.env.*','**/.git/**','**/private/**','**/data/**','**/*.sqlite*','**/*.pem','**/*.key']} } });
