/**
 * @file WorkspacePage.tsx
 * @description 工作区页面（保留路由兼容）：内容已抽取为可复用的 WorkspacePanel，
 * 可内嵌到各页面作为工作区预览侧边栏。本页面仅保留引导（Joyride）并渲染面板。
 */
import {Joyride} from 'react-joyride';
import {useGuide} from '../guides/useGuide';
import WorkspacePanel from '../components/WorkspacePanel';

export default function WorkspacePage() {
    const {run: guideRun, steps: guideSteps, handleJoyrideEvent} = useGuide('workspace');

    return (
        <>
            <WorkspacePanel/>
            <Joyride
                steps={guideSteps}
                run={guideRun}
                onEvent={handleJoyrideEvent}
                continuous
                options={{
                    showProgress: true,
                    skipBeacon: true,
                    primaryColor: '#f87171',
                    buttons: ['back', 'close', 'primary', 'skip'],
                    zIndex: 10000
                }}
            />
        </>
    );
}
