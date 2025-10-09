import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';

export default {
    input: 'sidepanel/index.js',
    output: {
        file: 'dist/sidepanel.bundle.js',
        format: 'iife',
        sourcemap: process.env.DEBUG === 'true',
        name: 'PM4Chrome'
    },
    onwarn(warning, warn) {
        const isOpenAI = (p) => /node_modules[\/\\]openai[\/\\]/.test(p || '');
        if (warning.code === 'CIRCULAR_DEPENDENCY') {
            const ids = warning.ids || warning.cycle || [];
            if (Array.isArray(ids) && ids.some(isOpenAI)) return; // ignore openai cycles
            if (isOpenAI(warning.importer) || /openai/.test(warning.message || '')) return;
        }
        if (warning.code === 'THIS_IS_UNDEFINED') {
            if (isOpenAI(warning.id || '') || /openai/.test(warning.message || '')) return; // benign in SDK
        }
        warn(warning);
    },
    plugins: [
        replace({
            preventAssignment: true,
            values: {
                __PRIVATEMODE_BASE_URL__: JSON.stringify(process.env.PRIVATEMODE_BASE_URL || ''),
                __PRIVATEMODE_API_KEY__: JSON.stringify(process.env.PRIVATEMODE_API_KEY || ''),
                __DEBUG__: JSON.stringify(process.env.DEBUG === 'true')
            }
        }),
        resolve({ browser: true, preferBuiltins: false }),
        commonjs()
    ]
};
