import {useState, useCallback} from 'react';
import type {EventData, Controls} from 'react-joyride';
import {STATUS} from 'react-joyride';
import {guideConfigs, isGuideSeen, markGuideSeen} from './index';

/**
 * 页面引导 Hook
 *
 * @param pageKey - 页面标识（如 'requirements'）
 * @returns {run, steps, handleJoyrideEvent}
 *
 * 用法：
 * ```tsx
 * const {run, steps, handleJoyrideEvent} = useGuide('requirements');
 * <Joyride steps={steps} run={run} onEvent={handleJoyrideEvent} continuous ... />
 * ```
 */
export function useGuide(pageKey: string) {
    const config = guideConfigs[pageKey];
    const [run, setRun] = useState(() => config ? !isGuideSeen(config.pageKey) : false);

    const handleJoyrideEvent = useCallback((data: EventData, _controls: Controls) => {
        const {status} = data;
        if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
            setRun(false);
            if (config) markGuideSeen(config.pageKey);
        }
    }, [config]);

    return {
        run,
        steps: config?.steps ?? [],
        handleJoyrideEvent,
    };
}
