// expo-clipboard needs its native module, which Jest does not have.
module.exports = {
  setStringAsync: jest.fn(() => Promise.resolve(true)),
  getStringAsync: jest.fn(() => Promise.resolve('')),
};
