import type { ExInfo } from './types';
import { LEGS } from './legs';
import { PUSH } from './push';
import { PULL } from './pull';
import { CORE } from './core';
import { EXTRA } from './extra';

export type { ExInfo };
export const EXINFO: Record<string, ExInfo> = { ...LEGS, ...PUSH, ...PULL, ...CORE, ...EXTRA };
