import { MotionConfig } from 'motion/react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Tutorial, tutorialSeen } from './components/Tutorial.tsx';
import { Auth } from './pages/Auth.tsx';
import { Home } from './pages/Home.tsx';
import { Profile } from './pages/Profile.tsx';
import { Room } from './pages/Room.tsx';
import { loadMe, useGame } from './store.ts';
import './styles.css';

function App() {
  const toast = useGame((s) => s.toast);
  const inGame = useGame((s) => s.room?.status === 'playing');
  const [rules, setRules] = useState(false);

  useEffect(() => {
    void loadMe();
  }, []);
  // 第一次进对局时自动弹一次玩法说明
  useEffect(() => {
    if (inGame && !tutorialSeen()) setRules(true);
  }, [inGame]);

  const openRules = () => setRules(true);

  return (
    // reducedMotion="user"：系统设置了“减少动态效果”的人不会看到位移动画
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route path="/" element={<Home onRules={openRules} />} />
        <Route path="/room/:code" element={<Room onRules={openRules} />} />
        <Route path="/login" element={<Auth />} />
        <Route path="/me" element={<Profile />} />
        <Route
          path="*"
          element={
            <main className="notice">
              <h1>这里什么也没有</h1>
              <Link className="btn btn-primary" to="/">
                回首页
              </Link>
            </main>
          }
        />
      </Routes>
      {rules && <Tutorial onClose={() => setRules(false)} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </MotionConfig>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
