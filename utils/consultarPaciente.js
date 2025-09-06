const { consultarInformacionPaciente: consultarPacienteDB } = require('./dbAPI');

async function consultarInformacionPaciente(numeroId) {
    if (!numeroId) {
        throw new Error("Falta el número de documento");
    }

    try {
        const resultado = await consultarPacienteDB(numeroId);
        
        if (resultado.success) {
            // Convertir a formato array compatible con el código existente
            return [resultado.data];
        } else {
            return [];
        }
    } catch (error) {
        console.error("❌ Error consultando información del paciente:", error);
        throw new Error("No se pudo consultar la información del paciente");
    }
}

module.exports = { consultarInformacionPaciente };
