/**
 * @file Vinyl.tsx
 * @description 黑胶唱片控件 —— 当前壁纸封面当唱片标签，播放时旋转
 * （系统开启「减少动态效果」时动画自动停用，见 index.css）
 */
import {type ReactNode} from 'react';
import {cn} from '../../lib/utils';

export function Vinyl({thumbUrl, fallbackIcon, playing, title}: {
    thumbUrl: string | null;
    fallbackIcon: ReactNode;
    playing: boolean;
    title: string;
}) {
    return (
        <div className={cn('wp-vinyl', playing && 'wp-vinyl--playing')} title={title}>
            <div className="wp-vinyl__grooves"/>
            <div className="wp-vinyl__cover">
                {thumbUrl ? <img src={thumbUrl} alt="" loading="lazy"/> : fallbackIcon}
            </div>
            <span className="wp-vinyl__hole"/>
        </div>
    );
}
