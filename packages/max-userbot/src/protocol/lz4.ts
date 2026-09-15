/** Максимальный распакованный payload MAX. Совпадает с ограничением
 * reverse-engineered серверной реализации и защищает воркер от zip-bomb. */
export const MAX_DECOMPRESSED_PAYLOAD_LENGTH = 1024 * 1024;

/**
 * Распаковка одного raw LZ4 block (не LZ4 frame). Протокол MAX передаёт
 * только сжатый блок и ставит флаг в старшем байте длины 10-байтового
 * заголовка; исходный размер в payload не записан.
 */
export function decompressLz4Block(
	input: Uint8Array,
	maxOutputLength = MAX_DECOMPRESSED_PAYLOAD_LENGTH,
): Buffer {
	const output = Buffer.allocUnsafe(maxOutputLength);
	let sourceOffset = 0;
	let outputOffset = 0;

	const readExtendedLength = (initial: number): number => {
		let length = initial;
		if (initial !== 15) return length;
		for (;;) {
			if (sourceOffset >= input.length) {
				throw new Error("Некорректный LZ4 block: оборвана длина");
			}
			const next = input[sourceOffset++];
			if (next === undefined) {
				throw new Error("Некорректный LZ4 block: оборвана длина");
			}
			length += next;
			if (next !== 255) return length;
		}
	};

	const ensureOutput = (length: number): void => {
		if (length < 0 || outputOffset + length > maxOutputLength) {
			throw new Error(
				`LZ4 payload превышает допустимые ${maxOutputLength} байт`,
			);
		}
	};

	while (sourceOffset < input.length) {
		const token = input[sourceOffset++];
		if (token === undefined) break;
		const literalLength = readExtendedLength(token >>> 4);
		if (sourceOffset + literalLength > input.length) {
			throw new Error("Некорректный LZ4 block: оборваны литералы");
		}
		ensureOutput(literalLength);
		output.set(
			input.subarray(sourceOffset, sourceOffset + literalLength),
			outputOffset,
		);
		sourceOffset += literalLength;
		outputOffset += literalLength;

		// Последняя последовательность блока может состоять только из литералов.
		if (sourceOffset === input.length) break;
		if (sourceOffset + 2 > input.length) {
			throw new Error("Некорректный LZ4 block: отсутствует offset");
		}
		const lowOffset = input[sourceOffset];
		const highOffset = input[sourceOffset + 1];
		if (lowOffset === undefined || highOffset === undefined) {
			throw new Error("Некорректный LZ4 block: отсутствует offset");
		}
		const matchOffset = lowOffset | (highOffset << 8);
		sourceOffset += 2;
		if (matchOffset === 0 || matchOffset > outputOffset) {
			throw new Error("Некорректный LZ4 block: недопустимый offset");
		}

		const matchLength = readExtendedLength(token & 0x0f) + 4;
		ensureOutput(matchLength);
		// Копируем побайтно: совпадения LZ4 могут перекрываться.
		for (let index = 0; index < matchLength; index++) {
			const matchedByte = output[outputOffset - matchOffset];
			if (matchedByte === undefined) {
				throw new Error("Некорректный LZ4 block: match вышел за буфер");
			}
			output[outputOffset] = matchedByte;
			outputOffset++;
		}
	}

	return output.subarray(0, outputOffset);
}
