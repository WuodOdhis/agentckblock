#![cfg_attr(target_arch = "riscv64", no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(test)]
extern crate alloc;

#[cfg(not(test))]
ckb_std::entry!(program_entry);
#[cfg(not(test))]
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_std::{
    ckb_constants::Source,
    high_level::{load_script, load_witness_args, load_tx_hash},
};
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use blake2b_ref::Blake2bBuilder;

pub fn blake2b_160(data: &[u8]) -> [u8; 20] {
    let mut result = [0u8; 32];
    let mut blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    blake2b.update(data);
    blake2b.finalize(&mut result);
    let mut hash = [0u8; 20];
    hash.copy_from_slice(&result[..20]);
    hash
}

#[cfg(test)]
mod tests {
    use super::blake2b_160;

    #[test]
    fn test_blake2b_160_empty_input() {
        let hash = blake2b_160(b"");
        assert_eq!(hash.len(), 20);
    }

    #[test]
    fn test_blake2b_160_known_input() {
        let hash = blake2b_160(b"hello world");
        assert_eq!(hash.len(), 20);
    }

    #[test]
    fn test_blake2b_160_compressed_key_length() {
        let data = [0x02u8; 33];
        let hash = blake2b_160(&data);
        assert_eq!(hash.len(), 20);
    }

    #[test]
    fn test_blake2b_160_different_inputs_different_hashes() {
        let hash1 = blake2b_160(b"input_a");
        let hash2 = blake2b_160(b"input_b");
        assert_ne!(hash1, hash2);
    }
}

pub fn program_entry() -> i8 {
    // 1. Read the Lock Script arguments (trusted Agent's expected Public Key Hash)
    let script = match load_script() {
        Ok(s) => s,
        Err(_) => return -1, // Error reading script
    };
    let expected_pubkey_hash = script.args().raw_data();
    
    // Verify that the args contains exactly a 20-byte Blake160 hash
    if expected_pubkey_hash.len() != 20 {
        return -2; // Invalid script args length
    }

    // 2. Read the Witness provided by the person spending the cell
    let witness_args = match load_witness_args(0, Source::GroupInput) {
        Ok(w) => w,
        Err(_) => return -3, // Error: No witness provided
    };

    // Extract the exact 'lock' field (which contains our 65-byte signature)
    let provided_sig_bytes = match witness_args.lock().to_opt() {
        Some(l) => l.raw_data(),
        None => return -4, // Error: Witness is missing the lock field
    };

    // Verify signature length is exactly 65 bytes (64 bytes compact signature + 1 byte recovery ID)
    if provided_sig_bytes.len() != 65 {
        return -5; // Invalid signature length
    }

    // 3. Load the Transaction Hash to verify the signature against
    let tx_hash = match load_tx_hash() {
        Ok(h) => h,
        Err(_) => return -6, // Error loading transaction hash
    };

    // 4. Perform Cryptographic SECP256K1 Signature Recovery
    let signature = match Signature::from_slice(&provided_sig_bytes[..64]) {
        Ok(s) => s,
        Err(_) => return -7, // Invalid signature format
    };

    let recovery_id = match RecoveryId::from_byte(provided_sig_bytes[64]) {
        Some(r) => r,
        None => return -8, // Invalid recovery ID
    };

    let recovered_key = match VerifyingKey::recover_from_prehash(&tx_hash, &signature, recovery_id) {
        Ok(k) => k,
        Err(_) => return -9, // Failed to recover public key
    };

    // 5. Hash the recovered compressed public key using Blake2b (Blake160)
    let pubkey_encoded = recovered_key.to_encoded_point(true); // true = compressed (33 bytes)
    let blake160_hash = blake2b_160(pubkey_encoded.as_bytes());

    // 6. Compare the derived public key hash with the expected one in args!
    if expected_pubkey_hash.as_ref() == blake160_hash {
        0 // Success! Authorized Agent signed this transaction.
    } else {
        -10 // Unauthorized: Signature recovered to a different public key
    }
}
