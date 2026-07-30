'use strict';

(() => {
    const FAILURE_STATES = new Set([
        'startup_failed',
        'crashed',
        'hung',
        'stop_timeout',
        'failed',
        'child_exited'
    ]);
    const BUTTON_COLOR_CLASSES = [
        'button-gray',
        'button-green',
        'button-orange',
        'button-red'
    ];

    function deriveOutputVisualState(output, systemState = '') {
        const desired = output?.desired === true;
        const observed = String(output?.observedState || 'stopped');
        if (FAILURE_STATES.has(observed)) return 'error';
        if (observed === 'starting') return 'starting';
        if (observed === 'stopping') return 'stopping';
        if (observed === 'running') {
            return desired ? 'on' : 'stopping';
        }
        if (desired && systemState === 'failed') return 'error';
        if (desired) return 'starting';
        return 'off';
    }

    function isTransitionState(state) {
        return state === 'starting' || state === 'stopping';
    }

    function deriveOutputButtonClass(state) {
        if (state === 'on') return 'button-green';
        if (isTransitionState(state)) return 'button-orange';
        if (state === 'error') return 'button-red';
        return 'button-gray';
    }

    function derivePendingVisualState(state, pendingDesired) {
        if (pendingDesired === true) return 'starting';
        if (pendingDesired === false) return 'stopping';
        return state;
    }

    function deriveOutputButtonText(buttonLabel, state, stateLabel) {
        return isTransitionState(state) ? stateLabel : buttonLabel;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            deriveOutputVisualState,
            deriveOutputButtonClass,
            derivePendingVisualState,
            deriveOutputButtonText,
            isTransitionState
        };
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
    }

    let latestStatus = null;
    const pending = new Map();
    let elements = null;

    function label(key, fallback) {
        return window.getLabel?.(key, fallback) || fallback;
    }

    function setToggle(button, state, disabled) {
        if (!button) return;
        const stateLabelKey =
            `output-control-state-${state}`;
        const buttonLabel = label(
            button.dataset.labelId,
            button.textContent
        );
        const stateLabel = label(stateLabelKey, state.toUpperCase());
        button.textContent = deriveOutputButtonText(
            buttonLabel,
            state,
            stateLabel
        );
        button.title = `${buttonLabel}: ${stateLabel}`;
        button.dataset.outputState = state;
        button.classList.remove(...BUTTON_COLOR_CLASSES);
        button.classList.add(deriveOutputButtonClass(state));
        button.classList.toggle('disabled', disabled === true);
        button.disabled = disabled === true;
        button.setAttribute(
            'aria-pressed',
            state === 'on' ? 'true' : 'false'
        );
        button.setAttribute(
            'aria-busy',
            isTransitionState(state) ? 'true' : 'false'
        );
    }

    function render() {
        if (!elements || !latestStatus) return;
        const installed = latestStatus.installed === true;
        elements.section.hidden = !installed;
        if (!installed) return;

        const available = latestStatus.available === true;
        let overallState = 'ready';
        if (!available || latestStatus.repairRequired === true) {
            overallState = 'repair';
        } else if (latestStatus.state === 'failed') {
            overallState = 'error';
        }
        elements.status.className =
            `output-control-status is-${overallState}`;
        elements.status.textContent = label(
            `output-control-status-${overallState}`,
            overallState.toUpperCase()
        );

        const operatorState = derivePendingVisualState(
            deriveOutputVisualState(
                latestStatus.outputs?.operatorMonitor,
                latestStatus.state
            ),
            pending.get('operatorMonitor')
        );
        const ndiState = derivePendingVisualState(
            deriveOutputVisualState(
                latestStatus.outputs?.ndi,
                latestStatus.state
            ),
            pending.get('ndi')
        );
        setToggle(
            elements.operator,
            operatorState,
            !available ||
                pending.has('operatorMonitor') ||
                isTransitionState(operatorState)
        );
        setToggle(
            elements.ndi,
            ndiState,
            !available ||
                pending.has('ndi') ||
                isTransitionState(ndiState)
        );

        const operatorActive =
            latestStatus.outputs?.operatorMonitor?.desired === true ||
            operatorState === 'on';
        const osdState =
            latestStatus.osd?.enabled === true ? 'on' : 'off';
        setToggle(
            elements.osd,
            osdState,
            !available ||
                !operatorActive ||
                pending.has('osd') ||
                isTransitionState(operatorState) ||
                operatorState === 'error'
        );
    }

    async function refreshStatus() {
        const api = window.electronAPI?.splitPonOutputControl;
        if (!api?.getStatus) return;
        try {
            latestStatus = await api.getStatus();
            render();
        } catch (error) {
            console.error(
                '[splitpon-output-control] Failed to read status:',
                error
            );
        }
    }

    async function setOutput(output) {
        const api = window.electronAPI?.splitPonOutputControl;
        const current = latestStatus?.outputs?.[output];
        if (!api?.setOutputEnabled || !current || pending.has(output)) {
            return;
        }
        const nextEnabled = current.desired !== true;
        pending.set(output, nextEnabled);
        render();
        try {
            latestStatus = await api.setOutputEnabled(
                output,
                nextEnabled
            );
        } catch (error) {
            console.error(
                `[splitpon-output-control] ${output} toggle failed:`,
                error
            );
            await refreshStatus();
        } finally {
            pending.delete(output);
            render();
        }
    }

    async function setOsd() {
        const api = window.electronAPI?.splitPonOutputControl;
        if (!api?.setOsdEnabled || !latestStatus || pending.has('osd')) {
            return;
        }
        pending.set('osd', true);
        render();
        try {
            latestStatus = await api.setOsdEnabled(
                latestStatus.osd?.desired !== true
            );
        } catch (error) {
            console.error(
                '[splitpon-output-control] OSD toggle failed:',
                error
            );
            await refreshStatus();
        } finally {
            pending.delete('osd');
            render();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        elements = {
            section:
                document.getElementById('splitpon-output-control'),
            status:
                document.getElementById('output-control-status'),
            operator:
                document.getElementById(
                    'output-control-operator-window-toggle'
                ),
            osd:
                document.getElementById('output-control-osd-toggle'),
            ndi:
                document.getElementById('output-control-ndi-toggle')
        };
        if (Object.values(elements).some((element) => !element)) return;

        elements.operator.addEventListener(
            'click',
            () => void setOutput('operatorMonitor')
        );
        elements.osd.addEventListener(
            'click',
            () => void setOsd()
        );
        elements.ndi.addEventListener(
            'click',
            () => void setOutput('ndi')
        );

        window.electronAPI?.splitPonOutputControl?.onStatus?.(
            (status) => {
                latestStatus = status;
                render();
            }
        );
        window.electronAPI?.onLanguageChanged?.(() => render());
        void refreshStatus();
    });
})();
