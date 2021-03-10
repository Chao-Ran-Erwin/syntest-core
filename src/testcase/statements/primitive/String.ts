import {PrimitiveStatement} from '../PrimitiveStatement'

import {getProperty, prng, Sampler} from '../../../index'

/**
 * @author Dimitri Stallenberg
 */
export class String extends PrimitiveStatement<string> {
    private readonly alphabet: string
    private readonly maxlength: number

    constructor(type: string, uniqueId: string, value: string, alphabet: string, maxlength: number) {
        super(type, uniqueId, value)
        this.alphabet = alphabet;
        this.maxlength = maxlength;
    }

    mutate(sampler: Sampler, depth: number): String {
        if (prng.nextBoolean(getProperty("resample_gene_probability"))) {
            return String.getRandom()
        }

        if (this.value.length > 0 && this.value.length < this.maxlength) {
            let value = prng.nextInt(0, 3)

            if (value === 0) {
                return this.addMutation()
            } else if (value === 1) {
                return this.removeMutation()
            } else if (value === 2) {
                return this.replaceMutation()
            } else {
                return this.deltaMutation()
            }
        } else if (this.value.length > 0) {
            let value = prng.nextInt(0, 2)

            if (value === 0) {
                return this.removeMutation()
            } else if (value === 1) {
                return this.replaceMutation()
            } else {
                return this.deltaMutation()
            }
        } else {
            return this.addMutation()
        }
    }

    addMutation(): String {
        let position = prng.nextInt(0, this.value.length - 1)
        let addedChar = prng.pickOne(this.alphabet)

        let newValue = ''

        for (let i = 0; i < this.value.length; i++) {
            if (i < position || i > position) {
                newValue += this.value[i]
            } else {
                newValue += addedChar
                newValue += this.value[i]
            }
        }

        return new String(
            this.type,
            this.id,
            newValue,
            this.alphabet,
            this.maxlength)
    }

    removeMutation(): String {
        let position = prng.nextInt(0, this.value.length - 1)

        let newValue = ''

        for (let i = 0; i < this.value.length; i++) {
            if (i === position) {
                continue
            }
            newValue += this.value[i]
        }

        return new String(this.type,
            this.id,
            newValue,
            this.alphabet,
            this.maxlength)
    }

    replaceMutation(): String {
        let position = prng.nextInt(0, this.value.length - 1)
        let newChar = prng.pickOne(this.alphabet)

        let newValue = ''

        for (let i = 0; i < this.value.length; i++) {
            if (i < position || i > position) {
                newValue += this.value[i]
            } else {
                newValue += newChar
            }
        }

        return new String(
            this.type,
            this.id,
            newValue,
            this.alphabet,
            this.maxlength)
    }

    deltaMutation(): String {
        let position = prng.nextInt(0, this.value.length - 1)
        let oldChar = this.value[position]
        let indexOldChar = this.alphabet.indexOf(oldChar)
        let delta = prng.pickOne([-2, -1, 1, -2])
        let newChar = this.alphabet[(indexOldChar + delta) % this.alphabet.length]

        let newValue = ''

        for (let i = 0; i < this.value.length; i++) {
            if (i < position || i > position) {
                newValue += this.value[i]
            } else {
                newValue += newChar
            }
        }

        return new String(
            this.type,
            this.id,
            newValue,
            this.alphabet,
            this.maxlength)
    }

    copy() {
        return new String(
            this.type,
            this.id,
            this.value,
            this.alphabet,
            this.maxlength)
    }

    static getRandom(type='string', alphabet = getProperty('string_alphabet'), maxlength = getProperty('string_maxlength')) {
        let valueLength = prng.nextInt(0, maxlength - 1)
        let value = ''

        for (let i = 0; i < valueLength; i++) {
            value += prng.pickOne(alphabet)
        }

        return new String(
            type,
            prng.uniqueId(),
            value,
            alphabet,
            maxlength)
    }
}