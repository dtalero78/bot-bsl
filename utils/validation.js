const { logError } = require('./shared');

/**
 * Sistema de validación comprehensive para inputs del bot
 * Centraliza toda la validación y sanitización de datos
 */
class ValidationService {
    
    /**
     * Valida números de cédula colombianos
     */
    static validarCedula(input) {
        const result = {
            isValid: false,
            value: null,
            error: null,
            sanitized: null
        };
        
        try {
            if (!input) {
                result.error = "Número de cédula es requerido";
                return result;
            }
            
            // Sanitizar input: remover espacios, puntos, comas
            const sanitized = String(input).trim().replace(/[^\d]/g, '');
            
            if (!sanitized) {
                result.error = "Número de cédula debe contener solo dígitos";
                return result;
            }
            
            // Validar longitud (6-12 dígitos para Colombia)
            if (sanitized.length < 6 || sanitized.length > 12) {
                result.error = "Número de cédula debe tener entre 6 y 12 dígitos";
                return result;
            }
            
            // Validar que no sean todos dígitos iguales
            if (/^(\d)\1+$/.test(sanitized)) {
                result.error = "Número de cédula no puede tener todos los dígitos iguales";
                return result;
            }
            
            result.isValid = true;
            result.value = sanitized;
            result.sanitized = sanitized;
            
        } catch (error) {
            result.error = "Error validando cédula";
            logError('ValidationService.validarCedula', error, { input });
        }
        
        return result;
    }
    
    /**
     * Valida números de teléfono
     */
    static validarTelefono(input) {
        const result = {
            isValid: false,
            value: null,
            error: null,
            sanitized: null
        };
        
        try {
            if (!input) {
                result.error = "Número de teléfono es requerido";
                return result;
            }
            
            // Sanitizar: remover espacios, paréntesis, guiones
            const sanitized = String(input).trim().replace(/[\s\-\(\)\+]/g, '');
            
            // Validar que solo contenga dígitos
            if (!/^\d+$/.test(sanitized)) {
                result.error = "Número de teléfono debe contener solo dígitos";
                return result;
            }
            
            // Validar longitud para números colombianos (10 dígitos) o internacionales (7-15)
            if (sanitized.length < 7 || sanitized.length > 15) {
                result.error = "Número de teléfono debe tener entre 7 y 15 dígitos";
                return result;
            }
            
            // Validar formato colombiano si aplica
            if (sanitized.length === 10 && !sanitized.startsWith('3')) {
                result.error = "Número de celular colombiano debe empezar con 3";
                return result;
            }
            
            result.isValid = true;
            result.value = sanitized;
            result.sanitized = sanitized;
            
        } catch (error) {
            result.error = "Error validando teléfono";
            logError('ValidationService.validarTelefono', error, { input });
        }
        
        return result;
    }
    
    /**
     * Valida mensajes de texto (sanitización básica)
     */
    static validarMensajeTexto(input, maxLength = 1000) {
        const result = {
            isValid: false,
            value: null,
            error: null,
            sanitized: null
        };
        
        try {
            if (!input) {
                result.error = "Mensaje no puede estar vacío";
                return result;
            }
            
            const text = String(input).trim();
            
            if (text.length === 0) {
                result.error = "Mensaje no puede estar vacío";
                return result;
            }
            
            if (text.length > maxLength) {
                result.error = `Mensaje no puede exceder ${maxLength} caracteres`;
                return result;
            }
            
            // Sanitizar caracteres potencialmente peligrosos
            const sanitized = text
                .replace(/[<>]/g, '') // Remover < >
                .replace(/javascript:/gi, '') // Remover javascript:
                .replace(/on\w+=/gi, ''); // Remover event handlers
            
            result.isValid = true;
            result.value = sanitized;
            result.sanitized = sanitized;
            
        } catch (error) {
            result.error = "Error validando mensaje";
            logError('ValidationService.validarMensajeTexto', error, { input });
        }
        
        return result;
    }
    
    /**
     * Valida valores monetarios
     */
    static validarValorMonetario(input) {
        const result = {
            isValid: false,
            value: null,
            error: null,
            sanitized: null,
            numericValue: null
        };
        
        try {
            if (!input) {
                result.error = "Valor monetario es requerido";
                return result;
            }
            
            // Sanitizar: remover todo excepto dígitos
            const sanitized = String(input).replace(/[^\d]/g, '');
            
            if (!sanitized) {
                result.error = "Valor monetario debe contener dígitos";
                return result;
            }
            
            const numericValue = parseInt(sanitized, 10);
            
            // Validar rango razonable (entre $1.000 y $10.000.000)
            if (numericValue < 1000) {
                result.error = "Valor monetario muy bajo (mínimo $1.000)";
                return result;
            }
            
            if (numericValue > 10000000) {
                result.error = "Valor monetario muy alto (máximo $10.000.000)";
                return result;
            }
            
            result.isValid = true;
            result.value = sanitized;
            result.sanitized = sanitized;
            result.numericValue = numericValue;
            
        } catch (error) {
            result.error = "Error validando valor monetario";
            logError('ValidationService.validarValorMonetario', error, { input });
        }
        
        return result;
    }
    
    /**
     * Valida nombres (personas, empresas)
     */
    static validarNombre(input, minLength = 2, maxLength = 100) {
        const result = {
            isValid: false,
            value: null,
            error: null,
            sanitized: null
        };
        
        try {
            if (!input) {
                result.error = "Nombre es requerido";
                return result;
            }
            
            const name = String(input).trim();
            
            if (name.length < minLength) {
                result.error = `Nombre debe tener al menos ${minLength} caracteres`;
                return result;
            }
            
            if (name.length > maxLength) {
                result.error = `Nombre no puede exceder ${maxLength} caracteres`;
                return result;
            }
            
            // Validar que contenga solo letras, espacios, acentos y algunos caracteres especiales
            if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s\-\.\']+$/.test(name)) {
                result.error = "Nombre contiene caracteres no válidos";
                return result;
            }
            
            // Sanitizar espacios múltiples
            const sanitized = name.replace(/\s+/g, ' ');
            
            result.isValid = true;
            result.value = sanitized;
            result.sanitized = sanitized;
            
        } catch (error) {
            result.error = "Error validando nombre";
            logError('ValidationService.validarNombre', error, { input });
        }
        
        return result;
    }
    
    /**
     * Valida opciones numéricas (para menús)
     */
    static validarOpcionNumerica(input, minValue = 1, maxValue = 10) {
        const result = {
            isValid: false,
            value: null,
            error: null,
            sanitized: null,
            numericValue: null
        };
        
        try {
            if (!input) {
                result.error = "Opción es requerida";
                return result;
            }
            
            const sanitized = String(input).trim();
            
            if (!/^\d+$/.test(sanitized)) {
                result.error = "Opción debe ser un número";
                return result;
            }
            
            const numericValue = parseInt(sanitized, 10);
            
            if (numericValue < minValue || numericValue > maxValue) {
                result.error = `Opción debe estar entre ${minValue} y ${maxValue}`;
                return result;
            }
            
            result.isValid = true;
            result.value = sanitized;
            result.sanitized = sanitized;
            result.numericValue = numericValue;
            
        } catch (error) {
            result.error = "Error validando opción";
            logError('ValidationService.validarOpcionNumerica', error, { input });
        }
        
        return result;
    }
    
    /**
     * Valida URLs básicas
     */
    static validarURL(input) {
        const result = {
            isValid: false,
            value: null,
            error: null,
            sanitized: null
        };
        
        try {
            if (!input) {
                result.error = "URL es requerida";
                return result;
            }
            
            const url = String(input).trim();
            
            // Validación básica de URL
            try {
                new URL(url);
                
                // Validar protocolo seguro
                if (!url.startsWith('https://') && !url.startsWith('http://')) {
                    result.error = "URL debe usar protocolo http:// o https://";
                    return result;
                }
                
                result.isValid = true;
                result.value = url;
                result.sanitized = url;
                
            } catch (urlError) {
                result.error = "Formato de URL no válido";
            }
            
        } catch (error) {
            result.error = "Error validando URL";
            logError('ValidationService.validarURL', error, { input });
        }
        
        return result;
    }
    
    /**
     * Valida archivos de imagen por tipo MIME
     */
    static validarTipoImagen(mimeType) {
        const result = {
            isValid: false,
            value: null,
            error: null,
            sanitized: null
        };
        
        try {
            if (!mimeType) {
                result.error = "Tipo MIME es requerido";
                return result;
            }
            
            const allowedTypes = [
                'image/jpeg',
                'image/jpg', 
                'image/png',
                'image/webp',
                'image/gif'
            ];
            
            const sanitized = String(mimeType).toLowerCase().trim();
            
            if (!allowedTypes.includes(sanitized)) {
                result.error = `Tipo de imagen no soportado. Permitidos: ${allowedTypes.join(', ')}`;
                return result;
            }
            
            result.isValid = true;
            result.value = sanitized;
            result.sanitized = sanitized;
            
        } catch (error) {
            result.error = "Error validando tipo de imagen";
            logError('ValidationService.validarTipoImagen', error, { mimeType });
        }
        
        return result;
    }
    
    /**
     * Valida múltiples campos en batch
     */
    static validarBatch(validations) {
        const results = {};
        let allValid = true;
        const errors = [];
        
        for (const [field, { validator, value, ...options }] of Object.entries(validations)) {
            let result;
            
            switch (validator) {
                case 'cedula':
                    result = this.validarCedula(value);
                    break;
                case 'telefono':
                    result = this.validarTelefono(value);
                    break;
                case 'mensaje':
                    result = this.validarMensajeTexto(value, options.maxLength);
                    break;
                case 'nombre':
                    result = this.validarNombre(value, options.minLength, options.maxLength);
                    break;
                case 'valor':
                    result = this.validarValorMonetario(value);
                    break;
                case 'opcion':
                    result = this.validarOpcionNumerica(value, options.minValue, options.maxValue);
                    break;
                case 'url':
                    result = this.validarURL(value);
                    break;
                case 'imagen':
                    result = this.validarTipoImagen(value);
                    break;
                default:
                    result = { isValid: false, error: `Validador '${validator}' no reconocido` };
            }
            
            results[field] = result;
            
            if (!result.isValid) {
                allValid = false;
                errors.push(`${field}: ${result.error}`);
            }
        }
        
        return {
            allValid,
            results,
            errors,
            sanitizedData: Object.fromEntries(
                Object.entries(results)
                    .filter(([_, result]) => result.isValid)
                    .map(([field, result]) => [field, result.sanitized])
            )
        };
    }
}

module.exports = ValidationService;