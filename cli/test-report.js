import { Report } from './src/report.js'

// Test the Report class validation
async function testReportValidation() {
  console.log('Testing Report class validation...\n')

  try {
    // Create a new report
    const report = new Report('test.eth', 12345)
    
    console.log('✅ Report created successfully')
    console.log('Initial content:', report.getContent())
    
    // Test setting decodedContenthash with valid data
    const validContenthash = {
      codec: 'ipfs-ns',
      value: 'QmHash123'
    }
    
    report.set('decodedContenthash', validContenthash)
    console.log('✅ Valid decodedContenthash set successfully')
    
    // Test setting version
    report.set('version', 4)
    console.log('✅ Valid version set successfully')
    
    // Test invalid field
    try {
      report.set('invalidField', 'value')
      console.log('❌ Should have thrown error for invalid field')
    } catch (error) {
      console.log('✅ Correctly rejected invalid field:', error.message)
    }
    
    // Test invalid type for decodedContenthash
    try {
      report.set('decodedContenthash', 'not an object')
      console.log('❌ Should have thrown error for invalid type')
    } catch (error) {
      console.log('✅ Correctly rejected invalid type:', error.message)
    }
    
    // Test missing required keys
    try {
      report.set('decodedContenthash', { codec: 'ipfs-ns' }) // missing 'value'
      console.log('❌ Should have thrown error for missing key')
    } catch (error) {
      console.log('✅ Correctly rejected missing key:', error.message)
    }
    
    // Test invalid nested type
    try {
      report.set('decodedContenthash', { codec: 123, value: 'QmHash123' }) // codec should be string
      console.log('❌ Should have thrown error for invalid nested type')
    } catch (error) {
      console.log('✅ Correctly rejected invalid nested type:', error.message)
    }
    
    console.log('\nFinal content:', report.getContent())
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

// Run the test
testReportValidation()
