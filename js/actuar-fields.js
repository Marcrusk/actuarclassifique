(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ActuarFields = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
    const DDDS = [
        11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
        41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
        71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99
    ];

    function text(value) { return value == null ? '' : String(value); }
    function digits(value) { return text(value).replace(/\D+/g, ''); }
    function letters(value) { return text(value).replace(/[^A-Za-zÀ-ÿ]+/g, ''); }

    function group(value, sizes, separators) {
        let rest = value; let out = '';
        for (let index = 0; index < sizes.length && rest.length; index += 1) {
            const chunk = rest.slice(0, sizes[index]);
            out += (out ? separators[index - 1] : '') + chunk;
            rest = rest.slice(sizes[index]);
        }
        return out;
    }

    function formatCnpj(value) { return group(digits(value).slice(0, 14), [2, 3, 3, 4, 2], ['.', '.', '/', '-']); }
    function formatCpf(value) { return group(digits(value).slice(0, 11), [3, 3, 3, 2], ['.', '.', '-']); }
    function formatCep(value) { return group(digits(value).slice(0, 8), [5, 3], ['-']); }
    function formatPhone(value) {
        const raw = digits(value).slice(0, 11);
        if (!raw) return '';
        if (raw.length <= 2) return `(${raw}`;
        const head = raw.slice(0, 2);
        const rest = raw.slice(2);
        const split = rest.length > 8 ? 5 : 4;
        return rest.length <= split ? `(${head}) ${rest}` : `(${head}) ${rest.slice(0, split)}-${rest.slice(split)}`;
    }
    function formatClientId(value) {
        const raw = text(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
        const prefix = raw.replace(/[^A-Z]/g, '').slice(0, 2);
        const suffix = raw.slice(prefix.length).replace(/\D+/g, '').slice(0, 4);
        return prefix + suffix;
    }
    function formatUf(value) { return letters(value).toUpperCase().slice(0, 2); }
    function formatEmail(value) { return text(value).trim().replace(/\s+/g, '').toLowerCase(); }
    function formatPlain(value) { return text(value).replace(/\s{2,}/g, ' ').replace(/^\s+/, ''); }

    function checkDigit(base, weights) {
        const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
        const rest = sum % 11;
        return rest < 2 ? 0 : 11 - rest;
    }

    function isValidCnpj(value) {
        const raw = digits(value);
        if (raw.length !== 14 || /^(\d)\1{13}$/.test(raw)) return false;
        const first = checkDigit(raw, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
        const second = checkDigit(raw, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
        return first === Number(raw[12]) && second === Number(raw[13]);
    }

    function isValidCpf(value) {
        const raw = digits(value);
        if (raw.length !== 11 || /^(\d)\1{10}$/.test(raw)) return false;
        const first = checkDigit(raw, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
        const second = checkDigit(raw, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
        return first === Number(raw[9]) && second === Number(raw[10]);
    }

    function isValidEmail(value) { return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(formatEmail(value)); }
    function isValidUf(value) { return UFS.includes(formatUf(value)); }
    function isValidClientId(value) { return /^[A-Z]{2}\d{4}$/.test(formatClientId(value)); }
    function isValidPhone(value) {
        const raw = digits(value);
        if (raw.length !== 10 && raw.length !== 11) return false;
        if (!DDDS.includes(Number(raw.slice(0, 2)))) return false;
        return raw.length === 11 ? raw[2] === '9' : /^[2-5]/.test(raw[2]);
    }

    const TYPES = {
        cnpj: {
            keep: /\d/,
            placeholder: '00.000.000/0000-00', inputMode: 'numeric', maxLength: 18, autocomplete: 'off',
            help: 'Digite apenas os números; a formatação é automática.',
            format: formatCnpj,
            validate: value => digits(value).length !== 14 ? 'O CNPJ precisa ter 14 dígitos.' : !isValidCnpj(value) ? 'CNPJ inválido: confira os dígitos verificadores.' : ''
        },
        cpf: {
            keep: /\d/,
            placeholder: '000.000.000-00', inputMode: 'numeric', maxLength: 14, autocomplete: 'off',
            format: formatCpf,
            validate: value => digits(value).length !== 11 ? 'O CPF precisa ter 11 dígitos.' : !isValidCpf(value) ? 'CPF inválido: confira os dígitos verificadores.' : ''
        },
        clientId: {
            keep: /[A-Za-z0-9]/,
            placeholder: 'TZ2345', inputMode: 'text', maxLength: 6, autocomplete: 'off',
            help: 'Duas letras e quatro números, como TZ2345.',
            format: formatClientId,
            validate: value => isValidClientId(value) ? '' : 'Use duas letras e quatro números, como TZ2345.'
        },
        uf: {
            keep: /[A-Za-zÀ-ÿ]/,
            placeholder: 'GO', inputMode: 'text', maxLength: 2, autocomplete: 'off',
            format: formatUf,
            validate: value => isValidUf(value) ? '' : 'Informe uma UF válida, como GO ou SP.'
        },
        email: {
            keep: /\S/,
            placeholder: 'nome@empresa.com.br', inputMode: 'email', maxLength: 120, autocomplete: 'off',
            format: formatEmail,
            validate: value => isValidEmail(value) ? '' : 'Informe um e-mail válido, com @ e domínio.'
        },
        phone: {
            keep: /\d/,
            placeholder: '(62) 99999-9999', inputMode: 'tel', maxLength: 16, autocomplete: 'off',
            help: 'Inclua o DDD.',
            format: formatPhone,
            validate: value => digits(value).length < 10 ? 'Informe o telefone com DDD.' : !isValidPhone(value) ? 'Telefone inválido: confira o DDD e o número.' : ''
        },
        cep: {
            keep: /\d/,
            placeholder: '00000-000', inputMode: 'numeric', maxLength: 9, autocomplete: 'off',
            format: formatCep,
            validate: value => digits(value).length === 8 ? '' : 'O CEP precisa ter 8 dígitos.'
        },
        text: { keep: /\S/, format: formatPlain, validate: () => '' }
    };

    function spec(type) { return TYPES[type] || null; }
    function format(type, value) { const found = spec(type); return found ? found.format(value) : formatPlain(value); }

    function validate(type, value, options = {}) {
        const found = spec(type);
        const formatted = format(type, value);
        const filled = formatted.trim() !== '';
        if (!filled) {
            return options.required
                ? { valid: false, value: formatted, message: options.requiredMessage || 'Preencha este campo.' }
                : { valid: true, value: formatted, message: '' };
        }
        const message = found ? found.validate(formatted) : '';
        return { valid: !message, value: formatted, message };
    }

    /* ----- ligação com o DOM (ignorada em ambiente sem document) ----- */

    const DEFAULT_KEEP = /\S/;
    function keepOf(type) { return spec(type)?.keep || DEFAULT_KEEP; }
    function keptCount(value, keep) {
        let total = 0;
        for (let index = 0; index < value.length; index += 1) if (keep.test(value[index])) total += 1;
        return total;
    }
    function caretFor(value, count, keep) {
        if (count <= 0) return 0;
        let seen = 0;
        for (let index = 0; index < value.length; index += 1) {
            if (keep.test(value[index])) { seen += 1; if (seen === count) return index + 1; }
        }
        return value.length;
    }

    function wrapper(input) { return input.closest ? (input.closest('.actuar-field') || input.parentElement) : input.parentElement; }

    function clearError(input) {
        input.removeAttribute('aria-invalid');
        const holder = wrapper(input);
        holder?.classList.remove('has-error');
        holder?.querySelector('[data-field-error]')?.remove();
    }

    function showError(input, message) {
        clearError(input);
        if (!message) return;
        input.setAttribute('aria-invalid', 'true');
        const holder = wrapper(input);
        if (!holder) return;
        holder.classList.add('has-error');
        const hint = input.ownerDocument.createElement('p');
        hint.className = 'actuar-field-error';
        hint.setAttribute('data-field-error', 'true');
        hint.textContent = message;
        holder.appendChild(hint);
    }

    function reformat(input) {
        const found = spec(input.dataset.field);
        if (!found) return;
        const before = input.value;
        const next = found.format(before);
        if (next === before) return;
        const keep = keepOf(input.dataset.field);
        const caret = typeof input.selectionStart === 'number' ? input.selectionStart : before.length;
        const kept = keptCount(before.slice(0, caret), keep);
        input.value = next;
        const position = caretFor(next, kept, keep);
        try { input.setSelectionRange(position, position); } catch (error) { /* campos sem seleção */ }
    }

    function check(input) {
        const required = input.required || input.dataset.fieldRequired === 'true';
        const result = validate(input.dataset.field, input.value, { required, requiredMessage: input.dataset.fieldRequiredMessage });
        input.value = result.value;
        showError(input, result.message);
        return result;
    }

    function bind(scope) {
        const target = scope || (typeof document !== 'undefined' ? document : null);
        if (!target || !target.querySelectorAll) return target;
        target.querySelectorAll('[data-field]').forEach(input => {
            const found = spec(input.dataset.field);
            if (!found || input.dataset.fieldBound === 'true') return;
            input.dataset.fieldBound = 'true';
            if (found.inputMode) input.setAttribute('inputmode', found.inputMode);
            if (found.maxLength) input.setAttribute('maxlength', String(found.maxLength));
            if (found.placeholder && !input.getAttribute('placeholder')) input.setAttribute('placeholder', found.placeholder);
            if (found.autocomplete) input.setAttribute('autocomplete', found.autocomplete);
            if (found.help && !wrapper(input)?.querySelector('.actuar-field-help')) {
                const hint = input.ownerDocument.createElement('p');
                hint.className = 'actuar-field-help';
                hint.textContent = found.help;
                wrapper(input)?.appendChild(hint);
            }
            input.addEventListener('input', () => { reformat(input); clearError(input); });
            input.addEventListener('blur', () => check(input));
        });
        return target;
    }

    function validateScope(scope) {
        const target = scope || (typeof document !== 'undefined' ? document : null);
        if (!target || !target.querySelectorAll) return { valid: true, errors: [] };
        const errors = [];
        target.querySelectorAll('[data-field]').forEach(input => {
            const result = check(input);
            if (!result.valid) errors.push({ input, field: input.dataset.field, message: result.message });
        });
        if (errors.length) errors[0].input.focus?.();
        return { valid: errors.length === 0, errors };
    }

    /* ==========================================================================
       DATA E HORA — UM FORMATO SÓ, LEGÍVEL POR PESSOA
       `18/08/2026 14:32` obriga a pessoa a converter mentalmente para saber se aquilo é
       recente. Numa lista de auditoria, que é lida de cima para baixo procurando "o que
       aconteceu agora", isso é trabalho jogado no leitor.

       A escala vai do relativo ao absoluto conforme o registro envelhece: o que é recente
       se descreve pela distância ("há 12 min"), o que já passou se descreve pela data. A
       precisão exata nunca some — vai no `title` de quem chama, via `formatFull`.

       `options.now` existe para o teste fixar o instante; sem isso, testar "ontem" seria
       um teste que muda de resultado à meia-noite. */
    const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

    function paraData(value) {
        if (value === null || value === undefined || value === '') return null;
        const data = value instanceof Date ? value : new Date(value);
        return Number.isNaN(data.getTime()) ? null : data;
    }

    function meiaNoite(data) {
        return new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime();
    }

    function horaDe(data) {
        return `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
    }

    function formatMoment(value, options = {}) {
        const vazio = options.empty !== undefined ? options.empty : '—';
        const data = paraData(value);
        if (!data) return vazio;
        const agora = paraData(options.now) || new Date();
        const minutos = Math.floor((agora.getTime() - data.getTime()) / 60000);
        const dias = Math.round((meiaNoite(agora) - meiaNoite(data)) / 86400000);

        // Futuro (agendamento, relógio adiantado) cai direto na data: "há -3 min" não existe.
        if (minutos >= 0) {
            if (minutos < 1) return 'agora';
            if (minutos < 60) return `há ${minutos} min`;
        }
        if (dias === 0) return `hoje, ${horaDe(data)}`;
        if (dias === 1) return `ontem, ${horaDe(data)}`;
        if (dias > 1 && dias < 7) return `${DIAS_CURTOS[data.getDay()]}, ${horaDe(data)}`;
        if (data.getFullYear() === agora.getFullYear()) return `${data.getDate()} ${MESES_CURTOS[data.getMonth()]}, ${horaDe(data)}`;
        return `${data.getDate()} ${MESES_CURTOS[data.getMonth()]} ${data.getFullYear()}`;
    }

    // Só o dia, para onde a hora não acrescenta nada (filtros, cabeçalhos de período).
    function formatDay(value, options = {}) {
        const vazio = options.empty !== undefined ? options.empty : '—';
        const data = paraData(value);
        if (!data) return vazio;
        const agora = paraData(options.now) || new Date();
        const dias = Math.round((meiaNoite(agora) - meiaNoite(data)) / 86400000);
        if (dias === 0) return 'hoje';
        if (dias === 1) return 'ontem';
        if (data.getFullYear() === agora.getFullYear()) return `${data.getDate()} ${MESES_CURTOS[data.getMonth()]}`;
        return `${data.getDate()} ${MESES_CURTOS[data.getMonth()]} ${data.getFullYear()}`;
    }

    // A precisão que o formato relativo abre mão: vai no title, ao alcance do mouse.
    function formatFull(value, options = {}) {
        const data = paraData(value);
        if (!data) return options.empty !== undefined ? options.empty : '';
        return `${String(data.getDate()).padStart(2, '0')} de ${MESES_CURTOS[data.getMonth()]} de ${data.getFullYear()} às ${horaDe(data)}`;
    }

    return {
        UFS, DDDS, TYPES,
        formatMoment, formatDay, formatFull,
        digits, format, validate, spec, keepOf, keptCount, caretFor,
        formatCnpj, formatCpf, formatCep, formatPhone, formatClientId, formatUf, formatEmail,
        isValidCnpj, isValidCpf, isValidEmail, isValidUf, isValidClientId, isValidPhone,
        bind, validateScope, check, clearError, showError
    };
});
