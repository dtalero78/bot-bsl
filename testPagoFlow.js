#!/usr/bin/env node

const { guardarEstadoPagoTemporal, verificarEstadoPagoTemporal, limpiarEstadoPagoTemporal } = require('./utils/dbAPI');

async function testFlow() {
    const testUserId = '573209596449'; // El usuario del ejemplo
    
    console.log('=== TEST DE FLUJO DE PAGO ===\n');
    
    // 1. Verificar estado inicial
    console.log('1. Verificando estado inicial...');
    let estado = await verificarEstadoPagoTemporal(testUserId);
    console.log('Estado inicial:', estado);
    console.log('');
    
    // 2. Guardar estado temporal (simular que se validó un comprobante)
    console.log('2. Guardando estado temporal (comprobante validado)...');
    const guardado = await guardarEstadoPagoTemporal(testUserId);
    console.log('Resultado guardado:', guardado);
    console.log('');
    
    // 3. Verificar que el estado se guardó correctamente
    console.log('3. Verificando estado después de guardar...');
    estado = await verificarEstadoPagoTemporal(testUserId);
    console.log('Estado después de guardar:', estado);
    console.log('');
    
    // 4. Limpiar estado (simular procesamiento exitoso)
    console.log('4. Limpiando estado temporal...');
    const limpiado = await limpiarEstadoPagoTemporal(testUserId);
    console.log('Resultado limpieza:', limpiado);
    console.log('');
    
    // 5. Verificar que el estado se limpió
    console.log('5. Verificando estado después de limpiar...');
    estado = await verificarEstadoPagoTemporal(testUserId);
    console.log('Estado final:', estado);
    console.log('');
    
    console.log('=== FIN DEL TEST ===');
    process.exit(0);
}

// Ejecutar test
testFlow().catch(error => {
    console.error('Error en test:', error);
    process.exit(1);
});