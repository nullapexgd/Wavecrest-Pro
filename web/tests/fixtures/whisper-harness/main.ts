import { transcribe } from '../../../src/reelcut/transcribe';
import { decodeWindow } from '../../../src/reelcut/audio';
Object.assign(window, { transcribe, decodeWindow });
