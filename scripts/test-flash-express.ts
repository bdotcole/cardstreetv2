import { createShipment, generateLabel, trackShipment, requestPickup } from '../lib/flashExpress';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testFlashExpress() {
    console.log('--- Testing Flash Express Integration ---');
    console.log('Environment:', process.env.FLASH_EXPRESS_ENV);

    try {
        // 1. Create Order
        console.log('\n1. Creating Order...');
        const orderParams = {
            outTradeNo: `TEST-${Date.now()}`,
            srcName: 'CardStreet Seller',
            srcPhone: '0812345678',
            srcProvinceName: 'กรุงเทพมหานคร',
            srcCityName: 'เขตบางรัก',
            srcDistrictName: 'บางรัก',
            srcPostalCode: '10500',
            srcDetailAddress: '123 Test Street',
            dstName: 'CardStreet Buyer',
            dstPhone: '0898765432',
            dstProvinceName: 'เชียงใหม่',
            dstCityName: 'เมืองเชียงใหม่',
            dstDistrictName: 'ศรีภูมิ',
            dstPostalCode: '50200',
            dstDetailAddress: '456 Test Ave',
            weight: 500,
            remark: 'Test order from CardStreet',
        };

        const flashOrder = await createShipment(orderParams);
        console.log('Order created successfully!');
        console.log('Tracking Number (pno):', flashOrder.pno);
        console.log('Sort Code:', flashOrder.sortCode);
        
        // 2. Print Label
        console.log('\n2. Generating Label...');
        const labelPdfBuffer = await generateLabel(flashOrder.pno);
        console.log(`Label generated! PDF size: ${labelPdfBuffer.length} bytes`);

        // 3. Request Pickup
        console.log('\n3. Requesting Pickup...');
        const pickupParams = {
            srcName: orderParams.srcName,
            srcPhone: orderParams.srcPhone,
            srcProvinceName: orderParams.srcProvinceName,
            srcCityName: orderParams.srcCityName,
            srcDistrictName: orderParams.srcDistrictName,
            srcPostalCode: orderParams.srcPostalCode,
            srcDetailAddress: orderParams.srcDetailAddress,
            estimateParcelNumber: 1,
            remark: 'Test pickup',
        };
        
        try {
            const pickup = await requestPickup(pickupParams);
            console.log('Pickup scheduled successfully!');
            console.log('Pickup Ticket ID:', pickup.ticketPickupId);
            console.log('Timeout At:', pickup.timeoutAtText);
        } catch (pickupErr: any) {
            console.error('Pickup request failed (this can happen in training env if address mapping is strictly validated or if cut-off time passed):', pickupErr.message);
        }

        // 4. Track Shipment
        console.log('\n4. Tracking Shipment...');
        const tracking = await trackShipment(flashOrder.pno);
        console.log('Tracking status:', tracking.stateText || tracking.state);
        console.log('Routes:', tracking.routes.length);
        
        console.log('\n--- Test Completed Successfully ---');

    } catch (error: any) {
        console.error('\nTest Failed:', error.message);
        if (error.response) {
            console.error(error.response.data);
        }
    }
}

testFlashExpress();
