/**
 * @file 应用入口模块
 * @description AI 开发工作台的前端入口文件，负责初始化 React 应用、
 *              配置客户端路由并挂载根组件到 DOM。
 *              采用 React Router v6 的嵌套路由方案，所有页面共享 Layout 布局。
 *
 *              启动时检查 CLI Provider 是否已配置，未配置时弹出引导弹窗。
 */

import React, {useEffect} from 'react';
import ReactDOM from 'react-dom/client';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import RequirementsPage from './pages/RequirementsPage';
import WorkspacePage from './pages/WorkspacePage';
import PlanPage from './pages/PlanPage';
import ExecutionPage from './pages/ExecutionPage';
import TestsPage from './pages/TestsPage';
import SkillsPage from './pages/SkillsPage';
import MCPPage from './pages/MCPPage';
import PipelinesPage from './pages/PipelinesPage';
import MinerUPage from './pages/MinerUPage';
import {ProviderSetupModal} from './components/ProviderSetupModal';
import {useAppStore} from './stores/app-store';
import {apiGet} from './api';

/** Provider 状态查询响应 */
interface ProviderStatusResponse {
    configured: boolean;
    active: string;
}

/**
 * 根组件 - 定义应用的路由结构 + CLI Provider 引导流程
 */
function App() {
    const {cliProvider, setCliProvider, setShowSetupModal} = useAppStore();

    // 启动时检查 CLI Provider 配置状态
    useEffect(() => {
        apiGet<ProviderStatusResponse>('/system/cli-provider/status')
            .then((data) => {
                setCliProvider(data.configured, data.active);
                if (!data.configured) {
                    setShowSetupModal(true);
                }
            })
            .catch(() => {
                // 查询失败时使用默认配置，不阻塞应用启动
            });
    }, [setCliProvider, setShowSetupModal]);

    return (
        <BrowserRouter>
            <Routes>
                <Route element={<Layout/>}>
                    <Route path="/" element={<RequirementsPage/>}/>
                    <Route path="/workspace" element={<WorkspacePage/>}/>
                    <Route path="/plan" element={<PlanPage/>}/>
                    <Route path="/execution" element={<ExecutionPage/>}/>
                    <Route path="/tests" element={<TestsPage/>}/>
                    <Route path="/skills" element={<SkillsPage/>}/>
                    <Route path="/mcp" element={<MCPPage/>}/>
                    <Route path="/pipelines" element={<PipelinesPage/>}/>
                    <Route path="/mineru" element={<MinerUPage/>}/>
                </Route>
            </Routes>

            {/* CLI Provider 引导弹窗 */}
            <ProviderSetupModal
                open={cliProvider.showSetupModal}
                onClose={() => setShowSetupModal(false)}
                onSelected={(providerId) => {
                    setCliProvider(true, providerId);
                    setShowSetupModal(false);
                }}
            />
        </BrowserRouter>
    );
}

// 获取 HTML 中的根挂载节点，以严格模式渲染 React 应用
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App/>
    </React.StrictMode>
);
