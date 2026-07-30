'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { areaMatchKey, areaNamesMatch, isBangkokLike, BANGKOK_CANONICAL } from '@/lib/utils/thaiAddressNormalize';

/**
 * Cascading จังหวัด → เขต/อำเภอ → แขวง/ตำบล selects backed by the canonical
 * dataset behind /api/thai-admin, replacing the free-text boxes that let a
 * Bangkok buyer save their khet and khwaeng in swapped columns (the un-shippable
 * address behind order d307f84c). Postcode auto-fills from the chosen
 * subdistrict and stays editable.
 *
 * Value keys use the PROFILES-COLUMN convention (the reverse of the dataset's):
 *   state    = อำเภอ/เขต  (dataset "district",    Flash cityName)
 *   district = แขวง/ตำบล  (dataset "subdistrict", Flash districtName)
 *
 * Legacy free-text values are matched prefix-insensitively ("เขตบางเขน" snaps
 * to "บางเขน"); a stored khet/khwaeng swap is detected and healed with a single
 * corrective onChange. Values that match nothing render as a disabled option so
 * the user sees what's currently saved and re-picks properly.
 */

export interface ThaiAddressValues {
    province: string;
    state: string;
    district: string;
    postcode: string;
}

interface AreaOpt { t: string; e: string }
interface SubOpt { t: string; e: string; z: string }

interface ThaiAddressFieldsProps {
    values: ThaiAddressValues;
    onChange: (patch: Partial<ThaiAddressValues>) => void;
    /** Applied to each select/input; defaults to the mobile dark-input style. */
    inputClassName?: string;
    labelClassName?: string;
    required?: boolean;
    disabled?: boolean;
}

const DEFAULT_INPUT_CLASS =
    'w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors';
const DEFAULT_LABEL_CLASS = 'text-[10px] font-bold uppercase tracking-wider text-slate-500';

// ---------------------------------------------------------------------------
// Module-level fetch caches — the dataset is static, so every mount of every
// surface shares one round-trip per slice.
// ---------------------------------------------------------------------------

let provincesPromise: Promise<AreaOpt[]> | null = null;
const districtsCache = new Map<string, Promise<AreaOpt[]>>();
const subdistrictsCache = new Map<string, Promise<SubOpt[]>>();

async function fetchSlice<T>(url: string, key: string): Promise<T[]> {
    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const body = await res.json();
        return (body?.[key] as T[]) || [];
    } catch {
        return [];
    }
}

function getProvinces(): Promise<AreaOpt[]> {
    if (!provincesPromise) {
        provincesPromise = fetchSlice<AreaOpt>('/api/thai-admin', 'provinces');
    }
    return provincesPromise;
}

function getDistricts(provinceT: string): Promise<AreaOpt[]> {
    let p = districtsCache.get(provinceT);
    if (!p) {
        p = fetchSlice<AreaOpt>(`/api/thai-admin?province=${encodeURIComponent(provinceT)}`, 'districts');
        districtsCache.set(provinceT, p);
    }
    return p;
}

function getSubdistricts(provinceT: string, districtT: string): Promise<SubOpt[]> {
    const key = `${provinceT}|${districtT}`;
    let p = subdistrictsCache.get(key);
    if (!p) {
        p = fetchSlice<SubOpt>(
            `/api/thai-admin?province=${encodeURIComponent(provinceT)}&district=${encodeURIComponent(districtT)}`,
            'subdistricts',
        );
        subdistrictsCache.set(key, p);
    }
    return p;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchOption<T extends AreaOpt>(options: T[], value: string): T | null {
    if (!areaMatchKey(value)) return null;
    return (
        options.find(o => areaNamesMatch(o.t, value)) ||
        options.find(o => areaNamesMatch(o.e, value)) ||
        null
    );
}

function matchProvinceOption(options: AreaOpt[], value: string): AreaOpt | null {
    if (isBangkokLike(value)) {
        return options.find(o => o.t === BANGKOK_CANONICAL) || null;
    }
    return matchOption(options, value);
}

const ThaiAddressFields: React.FC<ThaiAddressFieldsProps> = ({
    values,
    onChange,
    inputClassName = DEFAULT_INPUT_CLASS,
    labelClassName = DEFAULT_LABEL_CLASS,
    required = false,
    disabled = false,
}) => {
    const { t, isThai } = useTranslation();

    const [provinces, setProvinces] = useState<AreaOpt[]>([]);
    const [districts, setDistricts] = useState<AreaOpt[]>([]);
    const [subdistricts, setSubdistricts] = useState<SubOpt[]>([]);

    useEffect(() => {
        let alive = true;
        getProvinces().then(list => { if (alive) setProvinces(list); });
        return () => { alive = false; };
    }, []);

    const matchedProvince = useMemo(
        () => matchProvinceOption(provinces, values.province),
        [provinces, values.province],
    );

    useEffect(() => {
        if (!matchedProvince) { setDistricts([]); return; }
        let alive = true;
        getDistricts(matchedProvince.t).then(list => { if (alive) setDistricts(list); });
        return () => { alive = false; };
    }, [matchedProvince]);

    const matchedState = useMemo(() => {
        const direct = matchOption(districts, values.state);
        if (direct || !matchedProvince) return direct;
        // Legacy shorthand: bare "เมือง" or the province name repeated both
        // mean the provincial-capital district (mirrors
        // lib/thaiAdminAreas.findDistrict).
        const key = areaMatchKey(values.state);
        if (
            key === 'เมือง' || key === 'mueang' ||
            areaNamesMatch(values.state, matchedProvince.t) ||
            areaNamesMatch(values.state, matchedProvince.e)
        ) {
            return districts.find(d => d.t === `เมือง${matchedProvince.t}`) || null;
        }
        return null;
    }, [districts, values.state, matchedProvince]);

    useEffect(() => {
        if (!matchedProvince || !matchedState) { setSubdistricts([]); return; }
        let alive = true;
        getSubdistricts(matchedProvince.t, matchedState.t).then(list => { if (alive) setSubdistricts(list); });
        return () => { alive = false; };
    }, [matchedProvince, matchedState]);

    const matchedDistrict = useMemo(
        () => matchOption(subdistricts, values.district),
        [subdistricts, values.district],
    );

    // ── Swap self-heal ──
    // A saved khet/khwaeng inversion (state holds the แขวง, district holds the
    // เขต) matches nothing above. Detect it once per value-combination: if the
    // district-slot value names a real อำเภอ/เขต whose ตำบล list contains the
    // state-slot value, emit one corrective onChange. Existing swapped
    // profiles then heal the first time any address editor opens.
    const healAttemptedRef = useRef<string>('');
    useEffect(() => {
        if (disabled) return;
        if (!matchedProvince || districts.length === 0) return;
        if (matchedState || !values.state.trim() || !values.district.trim()) return;

        const healKey = `${values.province}|${values.state}|${values.district}`;
        if (healAttemptedRef.current === healKey) return;
        healAttemptedRef.current = healKey;

        const stateAsDistrict = matchOption(districts, values.district);
        if (!stateAsDistrict) return;

        let alive = true;
        getSubdistricts(matchedProvince.t, stateAsDistrict.t).then(subs => {
            if (!alive) return;
            const swappedSub = matchOption(subs, values.state);
            if (swappedSub) {
                onChange({
                    state: stateAsDistrict.t,
                    district: swappedSub.t,
                    postcode: swappedSub.z || values.postcode,
                });
            }
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matchedProvince, districts, matchedState, values.state, values.district, disabled]);

    const optionLabel = (o: AreaOpt) => (isThai || !o.e ? o.t : `${o.e} (${o.t})`);

    // The select needs an option for a stored value the dataset doesn't know
    // (legacy free text, typos) — rendered disabled so the current value stays
    // visible but the user must re-pick a real one.
    const syntheticOption = (value: string, matched: AreaOpt | null) =>
        value.trim() && !matched ? (
            <option value={value} disabled>
                {value}
            </option>
        ) : null;

    const selectValue = (value: string, matched: AreaOpt | null) => (matched ? matched.t : value);

    return (
        <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5 min-w-0">
                <label className={labelClassName}>
                    {t('addressFields.province')} {required && <span className="text-rose-400">*</span>}
                </label>
                <select
                    required={required}
                    disabled={disabled}
                    value={selectValue(values.province, matchedProvince)}
                    onChange={(e) => onChange({ province: e.target.value, state: '', district: '', postcode: '' })}
                    className={inputClassName}
                >
                    <option value="">{t('addressFields.selectProvince')}</option>
                    {syntheticOption(values.province, matchedProvince)}
                    {provinces.map(p => (
                        <option key={p.t} value={p.t}>{optionLabel(p)}</option>
                    ))}
                </select>
            </div>

            <div className="space-y-1.5 min-w-0">
                <label className={labelClassName}>
                    {t('addressFields.district')} {required && <span className="text-rose-400">*</span>}
                </label>
                <select
                    required={required}
                    disabled={disabled || !matchedProvince}
                    value={selectValue(values.state, matchedState)}
                    onChange={(e) => onChange({ state: e.target.value, district: '', postcode: '' })}
                    className={inputClassName}
                >
                    <option value="">{t('addressFields.selectDistrict')}</option>
                    {syntheticOption(values.state, matchedState)}
                    {districts.map(d => (
                        <option key={d.t} value={d.t}>{optionLabel(d)}</option>
                    ))}
                </select>
            </div>

            <div className="space-y-1.5 min-w-0">
                <label className={labelClassName}>
                    {t('addressFields.subdistrict')} {required && <span className="text-rose-400">*</span>}
                </label>
                <select
                    required={required}
                    disabled={disabled || !matchedState}
                    value={selectValue(values.district, matchedDistrict)}
                    onChange={(e) => {
                        const sub = subdistricts.find(s => s.t === e.target.value);
                        onChange({ district: e.target.value, ...(sub?.z ? { postcode: sub.z } : {}) });
                    }}
                    className={inputClassName}
                >
                    <option value="">{t('addressFields.selectSubdistrict')}</option>
                    {syntheticOption(values.district, matchedDistrict)}
                    {subdistricts.map(s => (
                        <option key={s.t} value={s.t}>{optionLabel(s)}</option>
                    ))}
                </select>
            </div>

            <div className="space-y-1.5 min-w-0">
                <label className={labelClassName}>
                    {t('addressFields.postcode')} {required && <span className="text-rose-400">*</span>}
                </label>
                <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    required={required}
                    disabled={disabled}
                    value={values.postcode}
                    onChange={(e) => onChange({ postcode: e.target.value })}
                    className={inputClassName}
                    placeholder={t('addressFields.postcodePlaceholder')}
                />
            </div>
        </div>
    );
};

export default ThaiAddressFields;
