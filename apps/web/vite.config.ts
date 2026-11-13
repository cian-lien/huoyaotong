import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 开发时把接口和 WebSocket 转给本地的服务端，这样前后端同源，cookie 登录不用处理跨域
const server = process.env.SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/socket.io': { target: server, ws: true },
    },
  },
});
