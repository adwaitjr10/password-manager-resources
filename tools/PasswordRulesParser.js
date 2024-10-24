// Copyright (c) 2019 - 2022 Apple Inc. Licensed under MIT License.

"use strict";

if (!console) {
    console = {
        assert: function () { },
        error: function () { },
        warn: function () { },
    };
}

const Identifier = {
    ASCII_PRINTABLE: "ascii-printable",
    DIGIT: "digit",
    LOWER: "lower",
    SPECIAL: "special",
    UNICODE: "unicode",
    UPPER: "upper",
};

const RuleName = {
    ALLOWED: "allowed",
    MAX_CONSECUTIVE: "max-consecutive",
    REQUIRED: "required",
    MIN_LENGTH: "minlength",
    MAX_LENGTH: "maxlength",
};

const CHARACTER_CLASS_START_SENTINEL = "[";
const CHARACTER_CLASS_END_SENTINEL = "]";
const PROPERTY_VALUE_SEPARATOR = ",";
const PROPERTY_SEPARATOR = ";";
const PROPERTY_VALUE_START_SENTINEL = ":";

const SPACE_CODE_POINT = " ".codePointAt(0);

const SHOULD_NOT_BE_REACHED = "Should not be reached";

class Rule {
    constructor(name, value) {
        this._name = name;
        this.value = value;
    }
    get name() { return this._name; }
    toString() { return JSON.stringify(this); }
};

class NamedCharacterClass {
    constructor(name) {
        console.assert(_isValidRequiredOrAllowedPropertyValueIdentifier(name));
        this._name = name;
    }
    get name() { return this._name.toLowerCase(); }
    toString() { return this._name; }
    toHTMLString() { return this._name; }
};

class CustomCharacterClass {
    constructor(characters) {
        console.assert(characters instanceof Array);
        this._characters = characters;
    }
    get characters() { return this._characters; }
    toString() { return `[${this._characters.join("")}]`; }
    toHTMLString() { return `[${this._characters.join("").replace('"', "&quot;")}]`; }
};

// MARK: Lexer functions

function _isIdentifierCharacter(c) {
    console.assert(c.length === 1);
    return c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "-";
}

function _isASCIIDigit(c) {
    console.assert(c.length === 1);
    return c >= "0" && c <= "9";
}

function _isASCIIPrintableCharacter(c) {
    console.assert(c.length === 1);
    return c >= " " && c <= "~";
}

function _isASCIIWhitespace(c) {
    console.assert(c.length === 1);
    return c === " " || c === "\f" || c === "\n" || c === "\r" || c === "\t";
}

// MARK: ASCII printable character bit set and canonicalization functions

function _bitSetIndexForCharacter(c) {
    console.assert(c.length == 1);
    return c.codePointAt(0) - SPACE_CODE_POINT;
}

function _characterAtBitSetIndex(index) {
    return String.fromCodePoint(index + SPACE_CODE_POINT);
}

function _markBitsForNamedCharacterClass(bitSet, namedCharacterClass) {
    console.assert(bitSet instanceof Array);
    console.assert(namedCharacterClass.name !== Identifier.UNICODE);
    console.assert(namedCharacterClass.name !== Identifier.ASCII_PRINTABLE);
    if (namedCharacterClass.name === Identifier.UPPER) {
        bitSet.fill(true, _bitSetIndexForCharacter("A"), _bitSetIndexForCharacter("Z") + 1);
    }
    else if (namedCharacterClass.name === Identifier.LOWER) {
        bitSet.fill(true, _bitSetIndexForCharacter("a"), _bitSetIndexForCharacter("z") + 1);
    }
    else if (namedCharacterClass.name === Identifier.DIGIT) {
        bitSet.fill(true, _bitSetIndexForCharacter("0"), _bitSetIndexForCharacter("9") + 1);
    }
    else if (namedCharacterClass.name === Identifier.SPECIAL) {
        bitSet.fill(true, _bitSetIndexForCharacter(" "), _bitSetIndexForCharacter("/") + 1);
        bitSet.fill(true, _bitSetIndexForCharacter(":"), _bitSetIndexForCharacter("@") + 1);
        bitSet.fill(true, _bitSetIndexForCharacter("["), _bitSetIndexForCharacter("`") + 1);
        bitSet.fill(true, _bitSetIndexForCharacter("{"), _bitSetIndexForCharacter("~") + 1);
    }
    else {
        console.assert(false, SHOULD_NOT_BE_REACHED, namedCharacterClass);
    }
}

function _markBitsForCustomCharacterClass(bitSet, customCharacterClass) {
    for (let character of customCharacterClass.characters) {
        bitSet[_bitSetIndexForCharacter(character)] = true;
    }
}

function _canonicalizedPropertyValues(propertyValues, keepCustomCharacterClassFormatCompliant) {
    let asciiPrintableBitSet = new Array("~".codePointAt(0) - " ".codePointAt(0) + 1);

    for (let propertyValue of propertyValues) {
        if (propertyValue instanceof NamedCharacterClass) {
            if (propertyValue.name === Identifier.UNICODE) {
                return [new NamedCharacterClass(Identifier.UNICODE)];
            }

            if (propertyValue.name === Identifier.ASCII_PRINTABLE) {
                return [new NamedCharacterClass(Identifier.ASCII_PRINTABLE)];
            }

            _markBitsForNamedCharacterClass(asciiPrintableBitSet, propertyValue);
        }
        else if (propertyValue instanceof CustomCharacterClass) {
            _markBitsForCustomCharacterClass(asciiPrintableBitSet, propertyValue);
        }
    }

    let charactersSeen = [];

    function checkRange(start, end) {
        let temp = [];
        for (let i = _bitSetIndexForCharacter(start); i <= _bitSetIndexForCharacter(end); ++i) {
            if (asciiPrintableBitSet[i]) {
                temp.push(_characterAtBitSetIndex(i));
            }
        }

        let result = temp.length === (_bitSetIndexForCharacter(end) - _bitSetIndexForCharacter(start) + 1);
        if (!result) {
            charactersSeen = charactersSeen.concat(temp);
        }
        return result;
    }

    let hasAllUpper = checkRange("A", "Z");
    let hasAllLower = checkRange("a", "z");
    let hasAllDigits = checkRange("0", "9");

    // Check for special characters, accounting for characters that are given special treatment (i.e. '-' and ']')
    let hasAllSpecial = false;
    let hasDash = false;
    let hasRightSquareBracket = false;
    let temp = [];
    for (let i = _bitSetIndexForCharacter(" "); i <= _bitSetIndexForCharacter("/"); ++i) {
        if (!asciiPrintableBitSet[i]) {
            continue;
        }

        let character = _characterAtBitSetIndex(i);
        if (keepCustomCharacterClassFormatCompliant && character === "-") {
            hasDash = true;
        }
        else {
            temp.push(character);
        }
    }
    for (let i = _bitSetIndexForCharacter(":"); i <= _bitSetIndexForCharacter("@"); ++i) {
        if (asciiPrintableBitSet[i]) {
            temp.push(_characterAtBitSetIndex(i));
        }
    }
    for (let i = _bitSetIndexForCharacter("["); i <= _bitSetIndexForCharacter("`"); ++i) {
        if (!asciiPrintableBitSet[i]) {
            continue;
        }

        let character = _characterAtBitSetIndex(i);
        if (keepCustomCharacterClassFormatCompliant && character === "]") {
            hasRightSquareBracket = true;
        }
        else {
            temp.push(character);
        }
    }
    for (let i = _bitSetIndexForCharacter("{"); i <= _bitSetIndexForCharacter("~"); ++i) {
        if (asciiPrintableBitSet[i]) {
            temp.push(_characterAtBitSetIndex(i));
        }
    }

    if (hasDash) {
        temp.unshift("-");
    }
    if (hasRightSquareBracket) {
        temp.push("]");
    }

    let numberOfSpecialCharacters = (_bitSetIndexForCharacter("/") - _bitSetIndexForCharacter(" ") + 1)
        + (_bitSetIndexForCharacter("@") - _bitSetIndexForCharacter(":") + 1)
        + (_bitSetIndexForCharacter("`") - _bitSetIndexForCharacter("[") + 1)
        + (_bitSetIndexForCharacter("~") - _bitSetIndexForCharacter("{") + 1);
    hasAllSpecial = temp.length === numberOfSpecialCharacters;
    if (!hasAllSpecial) {
        charactersSeen = charactersSeen.concat(temp);
    }

    let result = [];
    if (hasAllUpper && hasAllLower && hasAllDigits && hasAllSpecial) {
        return [new NamedCharacterClass(Identifier.ASCII_PRINTABLE)];
    }
    if (hasAllUpper) {
        result.push(new NamedCharacterClass(Identifier.UPPER));
    }
    if (hasAllLower) {
        result.push(new NamedCharacterClass(Identifier.LOWER));
    }
    if (hasAllDigits) {
        result.push(new NamedCharacterClass(Identifier.DIGIT));
    }
    if (hasAllSpecial) {
        result.push(new NamedCharacterClass(Identifier.SPECIAL));
    }
    if (charactersSeen.length) {
        result.push(new CustomCharacterClass(charactersSeen));
    }
    return result;
}

// MARK: Parser functions

function _indexOfNonWhitespaceCharacter(input, position = 0) {
    console.assert(position >= 0);
    console.assert(position <= input.length);

    let length = input.length;
    while (position < length && _isASCIIWhitespace(input[position]))
        ++position;

    return position;
}

function _parseIdentifier(input, position) {
    console.assert(position >= 0);
    console.assert(position < input.length);
    console.assert(_isIdentifierCharacter(input[position]));

    let length = input.length;
    let seenIdentifiers = [];
    do {
        let c = input[position];
        if (!_isIdentifierCharacter(c)) {
            break;
        }

        seenIdentifiers.push(c);
        ++position;
    } while (position < length);

    return [seenIdentifiers.join(""), position];
}

function _isValidRequiredOrAllowedPropertyValueIdentifier(identifier) {
    return identifier && Object.values(Identifier).includes(identifier.toLowerCase());
}

function _parseCustomCharacterClass(input, position) {
    console.assert(position >= 0);
    console.assert(position < input.length);
    console.assert(input[position] === CHARACTER_CLASS_START_SENTINEL);

    let length = input.length;
    ++position;
    if (position >= length) {
        console.error("Found end-of-line instead of character class character");
        return [null, position];
    }

    let initialPosition = position;
    let result = [];
    do {
        let c = input[position];
        if (!_isASCIIPrintableCharacter(c)) {
            ++position;
            continue;
        }

        if (c === "-" && (position - initialPosition) > 0) {
            // FIXME: Should this be an error?
            console.warn("Ignoring '-'; a '-' may only appear as the first character in a character class");
            ++position;
            continue;
        }

        result.push(c);
        ++position;
        if (c === CHARACTER_CLASS_END_SENTINEL) {
            break;
        }
    } while (position < length);

    if (position < length && input[position] !== CHARACTER_CLASS_END_SENTINEL || position == length && input[position - 1] == CHARACTER_CLASS_END_SENTINEL) {
        // Fix up result; we over consumed.
        result.pop();
        return [result, position];
    }

    if (position < length && input[position] == CHARACTER_CLASS_END_SENTINEL) {
        return [result, position + 1];
    }

    console.error("Found end-of-line instead of end of character class");
    return [null, position];
}

function _parsePasswordRequiredOrAllowedPropertyValue(input, position) {
    console.assert(position >= 0);
    console.assert(position < input.length);

    let length = input.length;
    let propertyValues = [];
    while (true) {
        if (_isIdentifierCharacter(input[position])) {
            let identifierStartPosition = position;
            var [propertyValue, position] = _parseIdentifier(input, position);
            if (!_isValidRequiredOrAllowedPropertyValueIdentifier(propertyValue)) {
                console.error("Unrecognized property value identifier: " + propertyValue);
                return [null, identifierStartPosition];
            }
            propertyValues.push(new NamedCharacterClass(propertyValue));
        }
        else if (input[position] == CHARACTER_CLASS_START_SENTINEL) {
            var [propertyValue, position] = _parseCustomCharacterClass(input, position);
            if (propertyValue && propertyValue.length) {
                propertyValues.push(new CustomCharacterClass(propertyValue));
            }
        }
        else {
            console.error("Failed to find start of property value: " + input.substr(position));
            return [null, position];
        }

        position = _indexOfNonWhitespaceCharacter(input, position);
        if (position >= length || input[position] === PROPERTY_SEPARATOR) {
            break;
        }

        if (input[position] === PROPERTY_VALUE_SEPARATOR) {
            position = _indexOfNonWhitespaceCharacter(input, position + 1);
            if (position >= length) {
                console.error("Found end-of-line instead of start of next property value");
                return [null, position];
            }
            continue;
        }

        console.error("Failed to find start of next property or property value: " + input.substr(position));
        return [null, position];
    }
    return [propertyValues, position];
}

function _parsePasswordRule(input, position) {
    let length = input.length;
    let startPosition = position;

    // Parse the identifier
    let [identifier, newPosition] = _parseIdentifier(input, position);
    position = newPosition;

    // Validate identifier
    if (!Object.values(RuleName).includes(identifier)) {
        console.error("Unrecognized property name: " + identifier);
        return [null, startPosition];
    }

    if (position >= length) {
        console.error("Unexpected end of input while parsing property value");
        return [null, position];
    }

    // Validate the property value start sentinel
    if (input[position] !== PROPERTY_VALUE_START_SENTINEL) {
        console.error("Expected property value start sentinel at: " + input.substr(position));
        return [null, position];
    }

    let property = { name: identifier, value: null };

    position = _indexOfNonWhitespaceCharacter(input, position + 1);

    // Handle empty property value (no value)
    if (position >= length || input[position] === PROPERTY_SEPARATOR) {
        return [new Rule(property.name, property.value), position];
    }

    let propertyValue;
    switch (identifier) {
        case RuleName.ALLOWED:
        case RuleName.REQUIRED:
            [propertyValue, position] = _parsePasswordRequiredOrAllowedPropertyValue(input, position);
            break;

        case RuleName.MAX_CONSECUTIVE:
            [propertyValue, position] = _parseMaxConsecutivePropertyValue(input, position);
            break;

        case RuleName.MIN_LENGTH:
        case RuleName.MAX_LENGTH:
            [propertyValue, position] = _parseMinLengthMaxLengthPropertyValue(input, position);
            break;

        default:
            console.assert(false, SHOULD_NOT_BE_REACHED);
            return [null, position];
    }

    if (propertyValue !== null) {
        property.value = propertyValue;
    }

    return [new Rule(property.name, property.value), position];
}


function _parseMinLengthMaxLengthPropertyValue(input, position) {
    return _parseInteger(input, position);
}

function _parseMaxConsecutivePropertyValue(input, position) {
    return _parseInteger(input, position);
}

function _parseInteger(input, position) {
    if (position < 0 || position >= input.length) {
        console.error("Invalid position: " + position);
        return [null, position];
    }

    if (!_isASCIIDigit(input[position])) {
        console.error("Failed to parse integer; not a number at position " + position + ": " + input.substr(position));
        return [null, position];
    }

    let result = 0;
    const length = input.length;
    const initialPosition = position;

    // Parse digits and build the integer
    while (position < length && _isASCIIDigit(input[position])) {
        result = 10 * result + parseInt(input[position], 10);
        ++position;
    }

    // Stop parsing when we encounter a separator or end of input
    if (position >= length || input[position] === PROPERTY_SEPARATOR) {
        return [result, position];
    }

    console.error("Failed to parse integer; unexpected character at position " + position + ": " + input.substr(initialPosition));
    return [null, position];
}


function _parsePasswordRulesInternal(input) {
    const parsedProperties = [];
    const length = input.length;
    let position = _indexOfNonWhitespaceCharacter(input);

    while (position < length) {
        if (!_isIdentifierCharacter(input[position])) {
            console.warn(`Failed to find start of property: ${input.substr(position)}`);
            return parsedProperties;
        }

        const [parsedProperty, newPosition] = _parsePasswordRule(input, position);
        position = newPosition;

        if (parsedProperty?.value) {
            parsedProperties.push(parsedProperty);
        }

        // Move position to next non-whitespace character
        position = _indexOfNonWhitespaceCharacter(input, position);
        if (position >= length) break;

        // If the current character is the property separator, move to next valid character
        if (input[position] === PROPERTY_SEPARATOR) {
            position = _indexOfNonWhitespaceCharacter(input, position + 1);
            if (position >= length) return parsedProperties;
            continue;
        }

        // If there's no valid next property, log error and return null
        console.error(`Failed to find start of next property: ${input.substr(position)}`);
        return null;
    }

    return parsedProperties;
}


function parsePasswordRules(input, formatRulesForMinifiedVersion) {
    const DEFAULT_ALLOWED_CLASS = new NamedCharacterClass(Identifier.ASCII_PRINTABLE);

    let passwordRules = _parsePasswordRulesInternal(input) || [];
    let suppressCopyingRequiredToAllowed = formatRulesForMinifiedVersion;

    let newPasswordRules = [];
    let newAllowedValues = [];
    let minMaxConsecutiveChars = null;
    let maxMinLength = 0;
    let minMaxLength = null;

    for (let rule of passwordRules) {
        switch (rule.name) {
            case RuleName.MAX_CONSECUTIVE:
                minMaxConsecutiveChars = (minMaxConsecutiveChars !== null)
                    ? Math.min(rule.value, minMaxConsecutiveChars)
                    : rule.value;
                break;

            case RuleName.MIN_LENGTH:
                maxMinLength = Math.max(rule.value, maxMinLength);
                break;

            case RuleName.MAX_LENGTH:
                minMaxLength = (minMaxLength !== null)
                    ? Math.min(rule.value, minMaxLength)
                    : rule.value;
                break;

            case RuleName.REQUIRED:
                const canonicalRequired = _canonicalizedPropertyValues(rule.value, formatRulesForMinifiedVersion);
                newPasswordRules.push(new Rule(rule.name, canonicalRequired));

                if (!suppressCopyingRequiredToAllowed) {
                    newAllowedValues.push(...canonicalRequired); // Avoid concat
                }
                break;

            case RuleName.ALLOWED:
                newAllowedValues.push(...rule.value); // Avoid concat
                break;
        }
    }

    // Canonicalize the final allowed values and handle default fallback
    if (!suppressCopyingRequiredToAllowed || newAllowedValues.length) {
        newAllowedValues = _canonicalizedPropertyValues(newAllowedValues, suppressCopyingRequiredToAllowed);

        // Add default ASCII_PRINTABLE class if empty
        if (!newAllowedValues.length) {
            newAllowedValues = [DEFAULT_ALLOWED_CLASS];
        }

        newPasswordRules.push(new Rule(RuleName.ALLOWED, newAllowedValues));
    }

    if (minMaxConsecutiveChars !== null) {
        newPasswordRules.push(new Rule(RuleName.MAX_CONSECUTIVE, minMaxConsecutiveChars));
    }

    if (maxMinLength > 0) {
        newPasswordRules.push(new Rule(RuleName.MIN_LENGTH, maxMinLength));
    }

    if (minMaxLength !== null) {
        newPasswordRules.push(new Rule(RuleName.MAX_LENGTH, minMaxLength));
    }

    return newPasswordRules;
}

