import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  orderBy, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc 
} from "firebase/firestore";
import { db } from "../config";

const CONTACTS_COLLECTION = "contacts";

export const submitContactForm = async (data) => {
  try {
    // Basic validation
    if (!data.name || !data.email || !data.message) {
      throw new Error("Missing required fields");
    }

    // Submit to Firestore with default 'Pending' status and project category
    const docRef = await addDoc(collection(db, CONTACTS_COLLECTION), {
      name: data.name.trim(),
      email: data.email.trim(),
      project: (data.project || 'Residential').trim(),
      message: data.message.trim(),
      status: 'Pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return { success: true, id: docRef.id };
  } catch (error) {
    console.error("Firestore Write Error (Contact):", error);
    throw new Error(error.message || "Failed to submit contact form");
  }
};

export const fetchContacts = async () => {
  try {
    const q = query(collection(db, CONTACTS_COLLECTION), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        // Existing inquiries without a status automatically default to 'Pending'
        status: data.status || 'Pending',
        project: data.project || 'Architectural Inquiry'
      };
    });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    throw new Error("Failed to load contacts");
  }
};

export const updateContactStatus = async (contactId, status) => {
  try {
    if (!contactId) throw new Error("Missing contact ID");
    const contactRef = doc(db, CONTACTS_COLLECTION, contactId);
    await updateDoc(contactRef, {
      status,
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    console.error("Firestore Write Error (Update Contact Status):", error);
    throw new Error(error.message || "Failed to update contact status");
  }
};

export const deleteContact = async (contactId) => {
  try {
    if (!contactId) throw new Error("Missing contact ID");
    const contactRef = doc(db, CONTACTS_COLLECTION, contactId);
    await deleteDoc(contactRef);
    return { success: true };
  } catch (error) {
    console.error("Firestore Delete Error (Contact):", error);
    throw new Error(error.message || "Failed to delete contact");
  }
};
