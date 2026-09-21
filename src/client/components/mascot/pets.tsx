/**
 * @file pets.tsx
 * @description 吉祥物宠物形象库 —— 三款自绘 kawaii SVG（无美术素材依赖）
 *
 * 形态（对齐 dsh-wallpaper-engine 的「吉祥物形态卡片」交互）：
 * - kitty   小猫喵：奶油色大头猫，橘色耳套与尾巴条纹
 * - shiba   柴犬君：橘色柴犬，白吻白肚，卷尾巴
 * - penguin 企鹅桑：蓝灰企鹅，白肚脸蛋，橙嘴橙脚蹼
 *
 * 统一动画契约（index.css .bongo-cat-* + paw-tap.ts）：
 * - 外层 svg 挂 .bongo-cat .bongo-cat--{mood}，typing 时左右爪 CSS 循环交替；
 * - 爪子 group 保留 .bongo-cat__paw--l / --r 钩子供输入镜像单次敲击重触发；
 * - mood: idle | typing | happy(^^ 眯眼笑) | sad(><)。
 */
import {cn} from '../../lib/utils';
import type {PetForm} from '../../stores/app-store';

export type MascotMood = 'idle' | 'typing' | 'happy' | 'sad';

export const PET_FORMS: Array<{id: PetForm; labelKey: string}> = [
    {id: 'kitty', labelKey: 'settings.mascot.formKitty'},
    {id: 'shiba', labelKey: 'settings.mascot.formShiba'},
    {id: 'penguin', labelKey: 'settings.mascot.formPenguin'},
];

/** 物种配色 */
interface SpeciesTheme {
    fur: string;
    furStroke: string;
    belly: string;
    innerEar: string;
    paw: string;
    pawStroke: string;
    blush: string;
    eye: string;
}

const THEMES: Record<PetForm, SpeciesTheme> = {
    kitty: {fur: '#fff7ef', furStroke: '#ecd9c3', belly: '#fffdf9', innerEar: '#ffc9d6', paw: '#fffdf9', pawStroke: '#ecd9c3', blush: '#ffb9c8', eye: '#3a3f4a'},
    shiba: {fur: '#f2b279', furStroke: '#d99a5b', belly: '#fff6ec', innerEar: '#fff6ec', paw: '#f6c08a', pawStroke: '#d99a5b', blush: '#ff9e8a', eye: '#4a3728'},
    penguin: {fur: '#556680', furStroke: '#3f4e63', belly: '#ffffff', innerEar: '#ffffff', paw: '#44536a', pawStroke: '#39485d', blush: '#ffb3c0', eye: '#2d3644'},
};

/** 眼睛：正常=大圆眼+双高光；happy=^^；sad=>< */
function Eyes({mood, x1, x2, y, color}: {mood: MascotMood; x1: number; x2: number; y: number; color: string}) {
    if (mood === 'happy') {
        return (
            <g stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none">
                <path d={`M${x1 - 8} ${y + 3} q8 -12 16 0`}/>
                <path d={`M${x2 - 8} ${y + 3} q8 -12 16 0`}/>
            </g>
        );
    }
    if (mood === 'sad') {
        return (
            <g stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none">
                <path d={`M${x1 - 6} ${y - 5} l12 9 M${x1 + 6} ${y - 5} l-12 9`}/>
                <path d={`M${x2 - 6} ${y - 5} l12 9 M${x2 + 6} ${y - 5} l-12 9`}/>
            </g>
        );
    }
    return (
        <g>
            <circle cx={x1} cy={y} r="7.5" fill={color}/>
            <circle cx={x2} cy={y} r="7.5" fill={color}/>
            <circle cx={x1 + 2.6} cy={y - 2.6} r="2.5" fill="#ffffff"/>
            <circle cx={x2 + 2.6} cy={y - 2.6} r="2.5" fill="#ffffff"/>
            <circle cx={x1 - 1.8} cy={y + 2.4} r="1.2" fill="#ffffff" opacity="0.85"/>
            <circle cx={x2 - 1.8} cy={y + 2.4} r="1.2" fill="#ffffff" opacity="0.85"/>
        </g>
    );
}

/** 嘴：正常=ω；happy=开心张嘴；sad=撇嘴 */
function Mouth({mood, x, y, color, happyTongue}: {mood: MascotMood; x: number; y: number; color: string; happyTongue?: boolean}) {
    if (mood === 'happy') {
        return (
            <g>
                <path d={`M${x - 7} ${y} q7 9 14 0`} fill="#7c3a44" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
                {happyTongue && <path d={`M${x - 3} ${y + 4} q3 5 6 0`} fill="#ff9eac"/>}
            </g>
        );
    }
    if (mood === 'sad') {
        return <path d={`M${x - 6} ${y + 4} q6 -6 12 0`} stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none"/>;
    }
    return (
        <path
            d={`M${x - 7} ${y - 1} q3.5 5 7 0 q3.5 5 7 0`}
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
        />
    );
}

/** 键盘（全物种共用） */
function Keyboard() {
    return (
        <g>
            <rect x="96" y="132" width="118" height="28" rx="7" fill="#3a3f4a"/>
            <g fill="#565d6d">
                {[0, 1, 2, 3].map((row) =>
                    [0, 1, 2, 3, 4, 5].map((col) => (
                        <rect key={`${row}-${col}`} x={102 + col * 18.5} y={136 + row * 0} width="14" height="4.5" rx="1.5"/>
                    ))
                )}
                <rect x="102" y="152" width="106" height="4.5" rx="1.5"/>
            </g>
        </g>
    );
}

/** 爪子（全物种同位，配色/形状随物种；class 钩子供输入镜像敲击） */
function Paws({t}: {t: SpeciesTheme}) {
    return (
        <g>
            <g className="bongo-cat__paw bongo-cat__paw--l">
                <ellipse cx="122" cy="127" rx="15" ry="10" fill={t.paw} stroke={t.pawStroke} strokeWidth="2"/>
                <path d="M114 125 v5 M120 124 v6 M126 124 v6 M132 125 v5" stroke={t.pawStroke} strokeWidth="1.6" strokeLinecap="round"/>
            </g>
            <g className="bongo-cat__paw bongo-cat__paw--r">
                <ellipse cx="172" cy="127" rx="15" ry="10" fill={t.paw} stroke={t.pawStroke} strokeWidth="2"/>
                <path d="M164 125 v5 M170 124 v6 M176 124 v6 M182 125 v5" stroke={t.pawStroke} strokeWidth="1.6" strokeLinecap="round"/>
            </g>
        </g>
    );
}

/** typing 时头顶冒代码符号 */
function Bits() {
    return (
        <g className="bongo-cat__bits" fill="none">
            <text x="118" y="46" className="bongo-cat__bit bongo-cat__bit--1" fill="#8b93a7" fontSize="13" fontWeight="600">{'</>'}</text>
            <text x="148" y="34" className="bongo-cat__bit bongo-cat__bit--2" fill="#8b93a7" fontSize="13" fontWeight="600">{'{ }'}</text>
            <text x="98" y="30" className="bongo-cat__bit bongo-cat__bit--3" fill="#8b93a7" fontSize="13" fontWeight="600">{';;'}</text>
        </g>
    );
}

/** 小猫喵：奶油大头猫 */
function Kitty({mood, t}: {mood: MascotMood; t: SpeciesTheme}) {
    return (
        <g>
            {/* 尾巴（橘纹卷尾） */}
            <path d="M180 116 q28 -6 24 -30 q-3 -17 -21 -13" fill="none" stroke={t.furStroke} strokeWidth="11" strokeLinecap="round"/>
            <path d="M186 106 q14 -4 13 -16" fill="none" stroke="#f5c89a" strokeWidth="5" strokeLinecap="round"/>
            {/* 身体 */}
            <ellipse cx="106" cy="120" rx="76" ry="38" fill={t.fur} stroke={t.furStroke} strokeWidth="2"/>
            {/* 头（大头比例） */}
            <circle cx="74" cy="74" r="47" fill={t.fur} stroke={t.furStroke} strokeWidth="2"/>
            {/* 耳朵 */}
            <path d="M36 50 L30 16 L60 34 Z" fill={t.fur} stroke={t.furStroke} strokeWidth="2" strokeLinejoin="round"/>
            <path d="M98 32 L116 8 L122 42 Z" fill={t.fur} stroke={t.furStroke} strokeWidth="2" strokeLinejoin="round"/>
            <path d="M43 42 L40 26 L54 36 Z" fill={t.innerEar}/>
            <path d="M103 30 L114 16 L118 36 Z" fill={t.innerEar}/>
            {/* 额头橘纹 */}
            <path d="M62 34 q4 9 0 16 M76 32 q4 9 0 16" stroke="#f5c89a" strokeWidth="4.5" strokeLinecap="round" fill="none"/>
            {/* 脸 */}
            <Eyes mood={mood} x1={58} x2={94} y={74} color={t.eye}/>
            <Mouth mood={mood} x={69} y={90} color={t.eye} happyTongue/>
            <ellipse cx="42" cy="88" rx="8" ry="4.5" fill={t.blush} opacity="0.6"/>
            <ellipse cx="110" cy="88" rx="8" ry="4.5" fill={t.blush} opacity="0.6"/>
            <g stroke="#d8c9b8" strokeWidth="2" strokeLinecap="round">
                <path d="M20 78 L38 80 M20 90 L38 89"/>
                <path d="M122 78 L140 80 M122 90 L140 89"/>
            </g>
        </g>
    );
}

/** 柴犬君：橘柴白吻 */
function Shiba({mood, t}: {mood: MascotMood; t: SpeciesTheme}) {
    return (
        <g>
            {/* 卷尾（甜甜圈） */}
            <circle cx="188" cy="92" r="16" fill="none" stroke={t.fur} strokeWidth="11"/>
            <circle cx="188" cy="92" r="16" fill="none" stroke={t.furStroke} strokeWidth="2" strokeDasharray="80 22" strokeDashoffset="-18"/>
            {/* 身体 */}
            <ellipse cx="106" cy="120" rx="76" ry="38" fill={t.fur} stroke={t.furStroke} strokeWidth="2"/>
            <ellipse cx="106" cy="130" rx="46" ry="22" fill={t.belly} opacity="0.85"/>
            {/* 头 + 腮帮绒毛 */}
            <circle cx="74" cy="74" r="47" fill={t.fur} stroke={t.furStroke} strokeWidth="2"/>
            <ellipse cx="54" cy="90" rx="16" ry="12" fill={t.belly}/>
            <ellipse cx="94" cy="90" rx="16" ry="12" fill={t.belly}/>
            {/* 立耳 */}
            <path d="M40 46 L38 16 L64 32 Z" fill={t.fur} stroke={t.furStroke} strokeWidth="2" strokeLinejoin="round"/>
            <path d="M100 30 L118 10 L122 40 Z" fill={t.fur} stroke={t.furStroke} strokeWidth="2" strokeLinejoin="round"/>
            <path d="M46 40 L45 26 L57 34 Z" fill={t.innerEar}/>
            {/* 白吻 */}
            <ellipse cx="74" cy="94" rx="20" ry="13" fill={t.belly}/>
            {/* 鼻头 */}
            <path d="M69 82 h10 l-5 6 Z" fill={t.eye}/>
            {/* 脸 */}
            <Eyes mood={mood} x1={56} x2={92} y={72} color={t.eye}/>
            <Mouth mood={mood} x={74} y={94} color={t.eye} happyTongue/>
            <ellipse cx="44" cy="84" rx="7" ry="4" fill={t.blush} opacity="0.55"/>
            <ellipse cx="104" cy="84" rx="7" ry="4" fill={t.blush} opacity="0.55"/>
        </g>
    );
}

/** 企鹅桑：蓝灰企鹅白肚脸 */
function Penguin({mood, t}: {mood: MascotMood; t: SpeciesTheme}) {
    return (
        <g>
            {/* 身体（蛋形一体） */}
            <path
                d="M106 26 C 156 26 176 66 176 106 C 176 142 146 158 106 158 C 66 158 36 142 36 106 C 36 66 56 26 106 26 Z"
                fill={t.fur}
                stroke={t.furStroke}
                strokeWidth="2"
            />
            {/* 白肚脸蛋 */}
            <path
                d="M106 44 C 138 44 152 72 152 104 C 152 134 132 148 106 148 C 80 148 60 134 60 104 C 60 72 74 44 106 44 Z"
                fill={t.belly}
            />
            {/* 头顶呆毛 */}
            <path d="M100 26 q6 -10 14 -6" fill="none" stroke={t.furStroke} strokeWidth="3" strokeLinecap="round"/>
            {/* 脸 */}
            <Eyes mood={mood} x1={84} x2={128} y={76} color={t.eye}/>
            {/* 橙嘴 */}
            {mood === 'happy' ? (
                <path d="M96 92 q10 10 20 0 q-10 8 -20 0" fill="#ff9f43" stroke="#e8862e" strokeWidth="1.5" strokeLinejoin="round"/>
            ) : (
                <path d="M97 90 h18 l-9 10 Z" fill="#ff9f43" stroke="#e8862e" strokeWidth="1.5" strokeLinejoin="round"/>
            )}
            <ellipse cx="72" cy="92" rx="7" ry="4" fill={t.blush} opacity="0.6"/>
            <ellipse cx="140" cy="92" rx="7" ry="4" fill={t.blush} opacity="0.6"/>
            {/* 小翅膀贴身 */}
            <path d="M40 96 q-8 22 8 34" fill="none" stroke={t.furStroke} strokeWidth="3" strokeLinecap="round"/>
            <path d="M172 96 q8 22 -8 34" fill="none" stroke={t.furStroke} strokeWidth="3" strokeLinecap="round"/>
        </g>
    );
}

/**
 * 宠物形象统一入口
 */
export function PetAvatar({form, mood, width, className}: {
    form: PetForm;
    mood: MascotMood;
    width?: number;
    className?: string;
}) {
    const t = THEMES[form];
    return (
        <svg
            viewBox="0 0 220 170"
            width={width}
            className={cn('bongo-cat', `bongo-cat--${mood}`, className)}
            aria-hidden
        >
            {form === 'kitty' && <Kitty mood={mood} t={t}/>}
            {form === 'shiba' && <Shiba mood={mood} t={t}/>}
            {form === 'penguin' && <Penguin mood={mood} t={t}/>}
            <Keyboard/>
            <Paws t={t}/>
            {mood === 'typing' && <Bits/>}
        </svg>
    );
}
